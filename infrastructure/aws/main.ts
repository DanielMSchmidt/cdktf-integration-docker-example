import { Construct } from "constructs";
import { App, TerraformAsset, TerraformOutput, TerraformStack } from "cdktf";
import * as path from "path";
import { sync as glob } from "glob";
import {
  AwsProvider,
  CloudfrontDistribution,
  CloudwatchLogGroup,
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
  S3Bucket,
  S3BucketObject,
  S3BucketPolicy,
  SecurityGroup,
} from "@cdktf/provider-aws";
import { DockerProvider } from "./.gen/providers/docker/docker-provider";
import { NullProvider } from "./.gen/providers/null/null-provider";
import { Resource } from "./.gen/providers/null/resource";
import { TerraformAwsModulesVpcAws as VPC } from "./.gen/modules/terraform-aws-modules/vpc/aws";
import { TerraformAwsModulesRdsAws } from "./.gen/modules/terraform-aws-modules/rds/aws";
import { Password } from "./.gen/providers/random/password";

const S3_ORIGIN_ID = "s3Origin";

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
  const tag = `${repo.repositoryUrl}:${version}-${asset.assetHash}`;
  // Workaround due to https://github.com/kreuzwerker/terraform-provider-docker/issues/189
  const image = new Resource(scope, p(`image-${tag}`), {});
  image.addOverride(
    "provisioner.local-exec.command",
    `
docker login -u ${auth.userName} -p ${auth.password} ${auth.proxyEndpoint} &&
docker build -t ${tag} ${asset.path} &&
docker push ${tag}
`
  );

  const password = new Password(scope, "db-password", {
    length: 16,
    special: false,
  });

  const dbPort = 5432;
  const serviceSecurityGroup = new SecurityGroup(
    scope,
    "service-security-group",
    {
      vpcId: vpc.vpcIdOutput,
      ingress: [
        {
          protocol: "TCP",
          fromPort: 80,
          toPort: 80,
          securityGroups: lb.securityGroups,
        },
      ],
      egress: [
        {
          fromPort: 0,
          toPort: 0,
          protocol: "-1",
          cidrBlocks: ["0.0.0.0/0"],
          ipv6CidrBlocks: ["::/0"],
        },
      ],
    }
  );
  const dbSecurityGroup = new SecurityGroup(scope, "db-security-group", {
    vpcId: vpc.vpcIdOutput,
    ingress: [
      {
        fromPort: dbPort,
        toPort: dbPort,
        protocol: "TCP",
        securityGroups: [serviceSecurityGroup.id],
      },
    ],
  });

  const db = new TerraformAwsModulesRdsAws(scope, "db", {
    identifier: "cdkday-test",

    engine: "postgres",
    engineVersion: "11.10",
    family: "postgres11",
    instanceClass: "db.t3.micro",
    allocatedStorage: "5",

    createDbOptionGroup: false,
    createDbParameterGroup: false,
    applyImmediately: true,

    name: "demodb",
    port: String(dbPort),
    username: "cdkday",
    password: password.result,

    maintenanceWindow: "Mon:00:00-Mon:03:00",
    backupWindow: "03:00-06:00",

    subnetIds: vpc.databaseSubnetsOutput as unknown as any, // 🙈
    vpcSecurityGroupIds: [dbSecurityGroup.id],
  });

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

  const logGroup = new CloudwatchLogGroup(scope, p("loggroup"), {
    name: `${cluster.name}/${name}`,
    retentionInDays: 30,
  });

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
        image: tag,
        cpu: 256,
        memory: 512,
        environment: [
          {
            name: "PORT",
            value: "80",
          },
          {
            name: "POSTGRES_USER",
            value: db.username,
          },
          {
            name: "POSTGRES_PASSWORD",
            value: db.password,
          },
          {
            name: "POSTGRES_DB",
            value: db.name,
          },
          {
            name: "POSTGRES_HOST",
            value: db.dbInstanceAddressOutput,
          },
          {
            name: "POSTGRES_PORT",
            value: db.dbInstancePortOutput,
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
            "awslogs-group": logGroup.name,
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
    healthCheck: [
      {
        enabled: true,
        path: "/ready",
      },
    ],
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
        pathPattern: [{ values: ["/backend/*"] }],
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
        securityGroups: [serviceSecurityGroup.id],
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
      databaseSubnets: ["10.0.201.0/24", "10.0.202.0/24", "10.0.203.0/24"],
      createDatabaseSubnetGroup: true,
      enableNatGateway: true,
      singleNatGateway: true,
    });

    const lbSecurityGroup = new SecurityGroup(this, "lb-security-group", {
      vpcId: vpc.vpcIdOutput,
      ingress: [
        {
          protocol: "TCP",
          fromPort: 80,
          toPort: 80,
          cidrBlocks: ["0.0.0.0/0"],
          ipv6CidrBlocks: ["::/0"],
        },
        {
          protocol: "TCP",
          fromPort: 443,
          toPort: 443,
          cidrBlocks: ["0.0.0.0/0"],
          ipv6CidrBlocks: ["::/0"],
        },
      ],
      egress: [
        {
          fromPort: 0,
          toPort: 0,
          protocol: "-1",
          cidrBlocks: ["0.0.0.0/0"],
          ipv6CidrBlocks: ["::/0"],
        },
      ],
    });
    const lb = new Lb(this, "lb", {
      name,
      internal: false,
      loadBalancerType: "application",
      securityGroups: [lbSecurityGroup.id],
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

    const { path: contentPath, assetHash: contentHash } = new TerraformAsset(
      this,
      "frontend",
      {
        path: path.resolve(__dirname, "../../application/frontend/build"),
      }
    );

    const bucket = new S3Bucket(this, "bucket", {
      bucketPrefix: `docker-example-frontend`,
      website: [
        {
          indexDocument: "index.html",
          errorDocument: "index.html",
        },
      ],
      tags: {
        "hc-internet-facing": "true",
      },
    });

    // TODO: glob files
    const files = glob("**/*.{json,js,html,png,ico,txt,map}", {
      cwd: contentPath,
    });

    files.forEach((f) => {
      const filePath = path.resolve(contentPath, f);
      new S3BucketObject(this, `${bucket.id}/${f}/${contentHash}`, {
        bucket: bucket.id,
        key: f,
        source: filePath,
        etag: `filemd5("${filePath}")`,
      });
    });

    new S3BucketPolicy(this, "s3_policy", {
      bucket: bucket.id,
      policy: JSON.stringify({
        Version: "2012-10-17",
        Id: "PolicyForWebsiteEndpointsPublicContent",
        Statement: [
          {
            Sid: "PublicRead",
            Effect: "Allow",
            Principal: "*",
            Action: ["s3:GetObject"],
            Resource: [`${bucket.arn}/*`, `${bucket.arn}`],
          },
        ],
      }),
    });

    new CloudfrontDistribution(this, "cf", {
      comment: `Docker example frontend`,
      enabled: true,
      defaultCacheBehavior: [
        {
          allowedMethods: [
            "DELETE",
            "GET",
            "HEAD",
            "OPTIONS",
            "PATCH",
            "POST",
            "PUT",
          ],
          cachedMethods: ["GET", "HEAD"],
          targetOriginId: S3_ORIGIN_ID,
          viewerProtocolPolicy: "redirect-to-https",
          forwardedValues: [
            { queryString: false, cookies: [{ forward: "none" }] },
          ],
        },
      ],
      origin: [
        {
          originId: S3_ORIGIN_ID,
          domainName: bucket.websiteEndpoint,
          customOriginConfig: [
            {
              originProtocolPolicy: "http-only",
              httpPort: 80,
              httpsPort: 443,
              originSslProtocols: ["TLSv1.2", "TLSv1.1", "TLSv1"],
            },
          ],
        },
      ],
      defaultRootObject: "index.html",
      restrictions: [{ geoRestriction: [{ restrictionType: "none" }] }],
      viewerCertificate: [{ cloudfrontDefaultCertificate: true }],
      aliases: [lb.dnsName],
    });
  }
}

const app = new App();
new MyStack(app, "example-staging");
app.synth();
