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
  lb: LbListener,
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

  const task = new EcsTaskDefinition(scope, p("task"), {
    dependsOn: [image],
    containerDefinitions: JSON.stringify([
      {
        name,
        image: `${repo}:1.0.0`, // TODO: get dynamically
        cpu: 1,
        memory: 512,
        portMappings: [
          {
            containerPort: 4000,
            hostPort: 80,
          },
        ],
      },
    ]),
    family: "service",
  });

  const targetGroup = new LbTargetGroup(scope, p("target-group"), {
    dependsOn: [lb],
    name: p("target-group"),
    port: 80,
    protocol: "HTTP",
    targetType: "instance",
    vpcId: vpc.vpcIdOutput,
  });

  new LbListenerRule(scope, p("rule"), {
    listenerArn: lb.arn,
    priority: 100,
    action: [
      {
        type: "forward",
        targetGroupArn: targetGroup.arn,
      },
    ],

    condition: [
      {
        hostHeader: [{ values: ["foo.bar"] }], // TODO: abstract
      },
    ],
  });

  new EcsService(scope, p("service"), {
    dependsOn: [cluster, task, lb],
    name,
    cluster: cluster.id,
    desiredCount: 1,
    taskDefinition: task.arn,
    loadBalancer: [
      {
        containerPort: 4000,
        containerName: name,
        targetGroupArn: targetGroup.arn,
      },
    ],
  });
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
    });

    const vpc = new VPC(this, "vpc", {
      name,
      cidr: "10.0.0.0/16",
      azs: ["a", "b", "c"].map((i) => `${region}${i}`),
      privateSubnets: ["10.0.1.0/24"],
      publicSubnets: ["10.0.2.0/24"],
      enableNatGateway: true,
    });

    const lb = new Lb(this, "lb", {
      name,
      internal: false,
      loadBalancerType: "application",
      subnets: [...(vpc.intraSubnets || []), ...(vpc.publicSubnets || [])],
      securityGroups: [vpc.defaultSecurityGroupIdOutput],
    });

    const lbl = new LbListener(this, "lb-listener", {
      loadBalancerArn: lb.arn,
      port: 443,
      protocol: "HTTPS",
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
      lbl,
      vpc
    );
  }
}

const app = new App();
new MyStack(app, "example-staging");
app.synth();
