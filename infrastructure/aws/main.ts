import { Construct } from "constructs";
import { App, TerraformAsset, TerraformOutput, TerraformStack } from "cdktf";
import * as path from "path";
import { sync as glob } from "glob";
import { lookup as mime } from "mime-types";
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

function PushedECRImage(scope: Construct, name: string, imagePath: string) {
  const repo = new EcrRepository(scope, `${name}-ecr`, {
    name,
  });

  const auth = new DataAwsEcrAuthorizationToken(scope, `${name}-auth`, {
    dependsOn: [repo],
    registryId: repo.registryId,
  });

  const asset = new TerraformAsset(scope, `${name}-project`, {
    path: imagePath,
  });

  const version = require(`${imagePath}/package.json`).version;
  const tag = `${repo.repositoryUrl}:${version}-${asset.assetHash}`;
  // Workaround due to https://github.com/kreuzwerker/terraform-provider-docker/issues/189
  const image = new Resource(scope, `${name}-image-${tag}`, {});
  image.addOverride(
    "provisioner.local-exec.command",
    `
docker login -u ${auth.userName} -p ${auth.password} ${auth.proxyEndpoint} &&
docker build -t ${tag} ${asset.path} &&
docker push ${tag}
`
  );

  return { image, tag };
}

function PostgresDB(
  scope: Construct,
  name: string,
  vpc: VPC,
  serviceSecurityGroup: SecurityGroup
) {
  const password = new Password(scope, `${name}-db-password`, {
    length: 16,
    special: false,
  });

  const dbPort = 5432;

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
    identifier: `${name}-db`,

    engine: "postgres",
    engineVersion: "11.10",
    family: "postgres11",
    instanceClass: "db.t3.micro",
    allocatedStorage: "5",

    createDbOptionGroup: false,
    createDbParameterGroup: false,
    applyImmediately: true,

    name,
    port: String(dbPort),
    username: `${name}user`,
    password: password.result,

    maintenanceWindow: "Mon:00:00-Mon:03:00",
    backupWindow: "03:00-06:00",

    subnetIds: vpc.databaseSubnetsOutput as unknown as any, // 🙈
    vpcSecurityGroupIds: [dbSecurityGroup.id],
  });

  return db;
}

function Cluster(scope: Construct, name: string) {
  const cluster = new EcsCluster(scope, name, {
    name,
    capacityProviders: ["FARGATE"],
  });

  return {
    cluster,
    runDockerImage(
      name: string,
      tag: string,
      image: Resource,
      env: Record<string, string | undefined>
    ) {
      const executionRole = new IamRole(scope, `${name}-execution-role`, {
        name: `execution-role`,
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

      const taskRole = new IamRole(scope, `${name}-task-role`, {
        name: `task-role`,
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

      const logGroup = new CloudwatchLogGroup(scope, `${name}-loggroup`, {
        name: `${cluster.name}/${name}`,
        retentionInDays: 30,
      });

      const task = new EcsTaskDefinition(scope, `${name}-task`, {
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
            environment: Object.entries(env).map(([name, value]) => ({
              name,
              value,
            })),
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

      return task;
    },
  };
}

function LoadBalancer(
  scope: Construct,
  name: string,
  vpc: VPC,
  cluster: EcsCluster
) {
  const lbSecurityGroup = new SecurityGroup(
    scope,
    `${name}-lb-security-group`,
    {
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
    }
  );
  const lb = new Lb(scope, `${name}-lb`, {
    name,
    internal: false,
    loadBalancerType: "application",
    securityGroups: [lbSecurityGroup.id],
  });
  // Due to output being reference to string array
  lb.addOverride("subnets", vpc.publicSubnetsOutput);

  const lbl = new LbListener(scope, `${name}-lb-listener`, {
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
            messageBody: "Could not find the resource you are looking for",
          },
        ],
      },
    ],
  });

  return {
    lb,
    exposeService(
      name: string,
      task: EcsTaskDefinition,
      serviceSecurityGroup: SecurityGroup
    ) {
      const targetGroup = new LbTargetGroup(scope, `${name}-target-group`, {
        dependsOn: [lbl],
        name: `target-group`,
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

      new LbListenerRule(scope, `${name}-rule`, {
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
            pathPattern: [{ values: ["/*"] }],
          },
        ],
      });

      const service = new EcsService(scope, `${name}-service`, {
        dependsOn: [lbl],
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
    },
  };
}

function PublicS3Bucket(
  scope: Construct,
  name: string,
  absoluteContentPath: string
) {
  const { path: contentPath, assetHash: contentHash } = new TerraformAsset(
    scope,
    `${name}-frontend`,
    {
      path: absoluteContentPath,
    }
  );

  const bucket = new S3Bucket(scope, `${name}-bucket`, {
    bucketPrefix: `${name}-frontend`,
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

  const files = glob("**/*.{json,js,html,png,ico,txt,map,css}", {
    cwd: absoluteContentPath,
  });

  files.forEach((f) => {
    const filePath = path.join(contentPath, f);
    new S3BucketObject(scope, `${bucket.id}/${f}/${contentHash}`, {
      bucket: bucket.id,
      key: f,
      source: filePath,
      contentType: mime(path.extname(f)) || "text/html",
      etag: `filemd5("${filePath}")`,
    });
  });

  new S3BucketPolicy(scope, `${name}-s3-policy`, {
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

  return bucket;
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

    const cluster = Cluster(this, "cluster");
    const loadBalancer = LoadBalancer(
      this,
      "loadbalancer",
      vpc,
      cluster.cluster
    );
    const serviceSecurityGroup = new SecurityGroup(
      this,
      `${name}-service-security-group`,
      {
        vpcId: vpc.vpcIdOutput,
        ingress: [
          {
            protocol: "TCP",
            fromPort: 80,
            toPort: 80,
            securityGroups: loadBalancer.lb.securityGroups,
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

    const db = PostgresDB(this, "dockerintegration", vpc, serviceSecurityGroup);

    const { image: backendImage, tag: backendTag } = PushedECRImage(
      this,
      "backend",
      path.resolve(__dirname, "../../application/backend")
    );

    const task = cluster.runDockerImage("backend", backendTag, backendImage, {
      PORT: "80",
      POSTGRES_USER: db.username,
      POSTGRES_PASSWORD: db.password,
      POSTGRES_DB: db.name,
      POSTGRES_HOST: db.dbInstanceAddressOutput,
      POSTGRES_PORT: db.dbInstancePortOutput,
    });
    loadBalancer.exposeService("backend", task, serviceSecurityGroup);

    const bucket = PublicS3Bucket(
      this,
      name,
      path.resolve(__dirname, "../../application/frontend/build")
    );

    const cdn = new CloudfrontDistribution(this, "cf", {
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
        {
          originId: "backend", // extract to constant
          domainName: loadBalancer.lb.dnsName,
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
      orderedCacheBehavior: [
        {
          allowedMethods: [
            "HEAD",
            "DELETE",
            "POST",
            "GET",
            "OPTIONS",
            "PUT",
            "PATCH",
          ],
          cachedMethods: ["HEAD", "GET"],
          pathPattern: "/backend/*",
          targetOriginId: "backend",
          defaultTtl: 10,
          viewerProtocolPolicy: "redirect-to-https",
          forwardedValues: [
            {
              queryString: true,
              headers: ["*"],
              cookies: [
                {
                  forward: "all",
                },
              ],
            },
          ],
        },
      ],
      defaultRootObject: "index.html",
      restrictions: [{ geoRestriction: [{ restrictionType: "none" }] }],
      viewerCertificate: [{ cloudfrontDefaultCertificate: true }],
    });

    new TerraformOutput(this, "lb-dns", {
      value: cdn.domainName,
    });
  }
}

const app = new App();
new MyStack(app, "example-staging");
app.synth();
