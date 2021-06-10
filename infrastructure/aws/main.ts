import { Construct } from "constructs";
import { App, TerraformAsset, TerraformOutput, TerraformStack } from "cdktf";
import * as path from "path";
import {
  AwsProvider,
  DataAwsEcrAuthorizationToken,
  EcrRepository,
  EcsCluster,
  EcsService,
  EcsTaskDefinition,
  IamRole,
  Lb,
  LbListener,
  LbListenerRule,
  LbTargetGroup,
} from "@cdktf/provider-aws";
import { DockerProvider } from "./.gen/providers/docker/docker-provider";
import { NullProvider } from "./.gen/providers/null/null-provider";
import { Resource } from "./.gen/providers/null/resource";
import { TerraformAwsModulesVpcAws as VPC } from "./.gen/modules/terraform-aws-modules/vpc/aws";

function DockerApplication(
  scope: Construct,
  name: string,
  path: string,
  cluster: EcsCluster,
  lb: Lb,
  lbl: LbListener,
  vpc: VPC
) {
  const p = (item: string) => `${name}-${item}`;
  const repo = new EcrRepository(scope, p("ecr"), {
    name,
  });

  const auth = new DataAwsEcrAuthorizationToken(scope, p("auth"), {
    dependsOn: [repo],
    registryId: repo.registryId,
  });

  const asset = new TerraformAsset(scope, p("project"), {
    path,
  });

  const version = require(`${path}/package.json`).version;
  // Workaround due to https://github.com/kreuzwerker/terraform-provider-docker/issues/189
  const image = new Resource(scope, p("image"), {});
  image.addOverride(
    "provisioner.local-exec.command",
    `
docker login -u ${auth.userName} -p ${auth.password} ${auth.proxyEndpoint} &&
docker build -t ${repo.repositoryUrl}:${version} ${asset.path} &&
docker push ${repo.repositoryUrl}:${version}
`
  );

  const executionRole = new IamRole(scope, p("execution-role"), {
    name: p("execution-role"),
    inlinePolicy: [
      {
        name: "allow-ecr-pull",
        policy: JSON.stringify({
          Version: "2012-10-17",
          Statement: [
            {
              Effect: "Allow",
              Action: [
                "ecr:GetAuthorizationToken",
                "ecr:BatchCheckLayerAvailability",
                "ecr:GetDownloadUrlForLayer",
                "ecr:BatchGetImage",
                "logs:CreateLogStream",
                "logs:PutLogEvents",
              ],
              Resource: "*",
            },
          ],
        }),
      },
    ],
    assumeRolePolicy: JSON.stringify({
      Version: "2012-10-17",
      Statement: [
        {
          Action: "sts:AssumeRole",
          Effect: "Allow",
          Sid: "",
          Principal: {
            Service: "ecs-tasks.amazonaws.com",
          },
        },
      ],
    }),
  });

  const taskRole = new IamRole(scope, p("task-role"), {
    name: p("task-role"),
    inlinePolicy: [
      {
        name: "allow-logs",
        policy: JSON.stringify({
          Version: "2012-10-17",
          Statement: [
            {
              Effect: "Allow",
              Action: ["logs:CreateLogStream", "logs:PutLogEvents"],
              Resource: "*",
            },
          ],
        }),
      },
    ],
    assumeRolePolicy: JSON.stringify({
      Version: "2012-10-17",
      Statement: [
        {
          Action: "sts:AssumeRole",
          Effect: "Allow",
          Sid: "",
          Principal: {
            Service: "ecs-tasks.amazonaws.com",
          },
        },
      ],
    }),
  });

  // https://docs.aws.amazon.com/AmazonECS/latest/developerguide/using_awslogs.html
  const task = new EcsTaskDefinition(scope, p("task"), {
    dependsOn: [image],
    cpu: "256",
    memory: "512",
    requiresCompatibilities: ["FARGATE", "EC2"],
    networkMode: "awsvpc",
    executionRoleArn: executionRole.arn,
    taskRoleArn: taskRole.arn,
    containerDefinitions: JSON.stringify([
      {
        name,
        image: `${repo.repositoryUrl}:${version}`,
        cpu: 256,
        memory: 512,
        environment: [
          {
            name: "PORT",
            value: "80",
          },
        ],
        portMappings: [
          {
            containerPort: 80,
            hostPort: 80,
          },
        ],
        logConfiguration: {
          logDriver: "awslogs",
          options: {
            "awslogs-group": `${cluster.name}/${name}`,
            "awslogs-region": "us-east-1",
            "awslogs-stream-prefix": name,
          },
        },
      },
    ]),
    family: "service",
  });

  const targetGroup = new LbTargetGroup(scope, p("target-group"), {
    dependsOn: [lbl],
    name: p("target-group"),
    port: 80,
    protocol: "HTTP",
    targetType: "ip",
    vpcId: vpc.vpcIdOutput,
  });

  new LbListenerRule(scope, p("rule"), {
    listenerArn: lbl.arn,
    priority: 100,
    action: [
      {
        type: "forward",
        targetGroupArn: targetGroup.arn,
      },
    ],

    condition: [
      {
        hostHeader: [{ values: [lb.dnsName] }],
      },
    ],
  });

  const service = new EcsService(scope, p("service"), {
    dependsOn: [cluster, task, lbl],
    name,
    launchType: "FARGATE",
    cluster: cluster.id,
    desiredCount: 1,
    taskDefinition: task.arn,
    networkConfiguration: [
      {
        subnets: [],
        assignPublicIp: true,
      },
    ],
    loadBalancer: [
      {
        containerPort: 80,
        containerName: name,
        targetGroupArn: targetGroup.arn,
      },
    ],
  });

  service.addOverride(
    "network_configuration.0.subnets",
    vpc.publicSubnetsOutput
  );
}

// TODO: tag everything
class MyStack extends TerraformStack {
  constructor(scope: Construct, name: string) {
    super(scope, name);
    const region = "us-east-1";

    new AwsProvider(this, "aws", {
      region,
    });
    new DockerProvider(this, "docker");
    new NullProvider(this, "provider", {});

    const cluster = new EcsCluster(this, "cluster", {
      name,
      capacityProviders: ["FARGATE"],
    });

    const vpc = new VPC(this, "vpc", {
      name,
      cidr: "10.0.0.0/16",
      azs: ["a", "b", "c"].map((i) => `${region}${i}`),
      privateSubnets: ["10.0.1.0/24", "10.0.2.0/24", "10.0.3.0/24"],
      publicSubnets: ["10.0.101.0/24", "10.0.102.0/24", "10.0.103.0/24"],
      enableNatGateway: true,
      singleNatGateway: true,
    });

    const lb = new Lb(this, "lb", {
      name,
      internal: false,
      loadBalancerType: "application",
      securityGroups: [vpc.defaultSecurityGroupIdOutput],
    });
    // Due to output being reference to string array
    lb.addOverride("subnets", vpc.publicSubnetsOutput);

    const lbl = new LbListener(this, "lb-listener", {
      loadBalancerArn: lb.arn,
      port: 80,
      protocol: "HTTP",
      defaultAction: [
        {
          type: "fixed-response",
          fixedResponse: [
            {
              contentType: "text/plain",
              statusCode: "404",
              messageBody: "Could not find the resource your are looking for",
            },
          ],
        },
      ],
    });

    new TerraformOutput(this, "lb-dns", {
      value: lb.dnsName,
    });

    DockerApplication(
      this,
      "backend",
      path.resolve(__dirname, "../../application/backend"),
      cluster,
      lb,
      lbl,
      vpc
    );
  }
}

const app = new App();
new MyStack(app, "example-staging");
app.synth();
