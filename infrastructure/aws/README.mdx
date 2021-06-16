# AWS Docker Integration Example

Did you ever wanted to get a backend service in a Docker container with a static (e.g. React) frontend running on AWS?
In this example we are going to walk you through how to set everything up in AWS and how to configure the backend to run against a Postgres Database, all using the CDK for Terraform.

First of all we start with `cdktf init --template typescript` to get our project setup started. This gives us a `main.ts` file as entrypoint for our infrastructure definition. To start we first need to configure a Virtual Private Cloud (VPC) to host all of our resources in, most services need to have an association with a VPC.

```ts
import { TerraformAwsModulesVpcAws as VPC } from "./.gen/modules/terraform-aws-modules/vpc/aws";

class MyStack extends TerraformStack {
  constructor(scope: Construct, name: string) {
    super(scope, name);
    const region = "us-east-1";

    // We need to instanciate all providers we are going to use
    new AwsProvider(this, "aws", {
      region,
    });
    new DockerProvider(this, "docker");
    new NullProvider(this, "provider", {});

    const vpc = new VPC(this, "vpc", {
      // We use the name of the stack
      name,
      // We tag every resource with the same set of tags to easily identify the resources
      tags,
      cidr: "10.0.0.0/16",
      // We want to run on three availability zones
      azs: ["a", "b", "c"].map((i) => `${region}${i}`),
      // We need three CIDR blocks as we have three availability zones
      privateSubnets: ["10.0.1.0/24", "10.0.2.0/24", "10.0.3.0/24"],
      publicSubnets: ["10.0.101.0/24", "10.0.102.0/24", "10.0.103.0/24"],
      databaseSubnets: ["10.0.201.0/24", "10.0.202.0/24", "10.0.203.0/24"],
      createDatabaseSubnetGroup: true,
      enableNatGateway: true,
      // Using a single NAT Gateway will save us some money, coming with the cost of less redundancy
      singleNatGateway: true,
    });
  }
}

const app = new App();
new MyStack(app, "example-docker-aws");
app.synth();
```

Now that we have the VPC set up we need to create a ECS Cluster to host our dockerized application in.
For this we create a nice, reusable abstraction that we can share with others:

```ts
function Cluster(scope: Construct, name: string) {
  const cluster = new EcsCluster(scope, name, {
    name,
    capacityProviders: ["FARGATE"],
    tags,
  });

  return {
    cluster,
    // We expose this function to run our task later on
    runDockerImage(
      name: string,
      tag: string,
      image: Resource,
      env: Record<string, string | undefined>
    ) {
      // Role that allows us to get the Docker image
      const executionRole = new IamRole(scope, `${name}-execution-role`, {
        name: `${name}-execution-role`,
        tags,
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

      // Role that allows us to push logs
      const taskRole = new IamRole(scope, `${name}-task-role`, {
        name: `${name}-task-role`,
        tags,
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

      // Creates a log group for the task
      const logGroup = new CloudwatchLogGroup(scope, `${name}-loggroup`, {
        name: `${cluster.name}/${name}`,
        retentionInDays: 30,
        tags,
      });

      // Creates a task that runs the docker container
      const task = new EcsTaskDefinition(scope, `${name}-task`, {
        // We want to wait until the image is actually pushed
        dependsOn: [image],
        tags,
        // These values are fixed for the example, we can make them part of our function invocation if we want to change them
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
                // Defines the log group and prefix
                "awslogs-group": logGroup.name,
                "awslogs-region": REGION,
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

class MyStack extends TerraformStack {
  constructor(scope: Construct, name: string) {
    // ...
    const cluster = Cluster(this, "cluster");
  }
}
```

Our service has some dependencies, it needs a load balancer and a postgres database.
The service also needs a security group to run in and that security group needs to allow access to the load balancer and to the database.
We start by creating a Load Balancer:

```ts
class LoadBalancer extends Resource {
  lb: Lb;
  lbl: LbListener;
  vpc: VPC;
  cluster: EcsCluster;

  constructor(scope: Construct, name: string, vpc: VPC, cluster: EcsCluster) {
    super(scope, name);
    this.vpc = vpc;
    this.cluster = cluster;

    const lbSecurityGroup = new SecurityGroup(
      scope,
      `${name}-lb-security-group`,
      {
        vpcId: vpc.vpcIdOutput,
        tags,
        ingress: [
          // allow HTTP traffic from everywhere
          {
            protocol: "TCP",
            fromPort: 80,
            toPort: 80,
            cidrBlocks: ["0.0.0.0/0"],
            ipv6CidrBlocks: ["::/0"],
          },
        ],
        egress: [
          // allow all traffic to every destination
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
    this.lb = new Lb(scope, `${name}-lb`, {
      name,
      tags,
      // we want this to be our public load balancer so that cloudfront can access it
      internal: false,
      loadBalancerType: "application",
      securityGroups: [lbSecurityGroup.id],
    });

    // This is necessary due to a shortcoming in our token system to be adressed in
    // https://github.com/hashicorp/terraform-cdk/issues/651
    this.lb.addOverride("subnets", vpc.publicSubnetsOutput);

    this.lbl = new LbListener(scope, `${name}-lb-listener`, {
      loadBalancerArn: this.lb.arn,
      port: 80,
      protocol: "HTTP",
      tags,
      defaultAction: [
        // We define a fixed 404 message, just in case
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
  }

  exposeService(
    name: string,
    task: EcsTaskDefinition,
    serviceSecurityGroup: SecurityGroup
  ) {
    // we will discuss this later on
  }
}

class MyStack extends TerraformStack {
  constructor(scope: Construct, name: string) {
    // ...
    const loadBalancer = new LoadBalancer(
      this,
      "loadbalancer",
      vpc,
      cluster.cluster
    );
  }
}
```

The `LoadBalancer` resource creates a `SecurityGroup` that allows the Load Balancer to receive traffic on port 80 and send traffic to any destination.
We then create a `Lb` resource, which builds an Application Load Balancer (ALB) for us.
To receive traffic we create a Load Balancer Listener for port 80. We don't expose port 443 currently, as SSL is handled by CloudFront later on.
If we wanted to expose the `Lb` directly on the internet we would change the port to 443 and the protocol to HTTPS while creating a valid certificate.

To see something in case our backend service is not responding we create a defaultAction that returns a static text.
We use a `SecurityGroup` to allow our load balancer to access the service:

```ts
class MyStack extends TerraformStack {
  constructor(scope: Construct, name: string) {
    // ...
    const serviceSecurityGroup = new SecurityGroup(
      this,
      `${name}-service-security-group`,
      {
        vpcId: vpc.vpcIdOutput,
        tags,
        ingress: [
          // only allow incoming traffic from our load balancer
          {
            protocol: "TCP",
            fromPort: 80,
            toPort: 80,
            securityGroups: loadBalancer.lb.securityGroups,
          },
        ],
        egress: [
          // allow all outgoing traffic
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
  }
}
```

Now we can use this security group to allow the postgres instance to receive traffic from our service:

```ts
class PostgresDB extends Resource {
  public instance: TerraformAwsModulesRdsAws;

  constructor(
    scope: Construct,
    name: string,
    vpc: VPC,
    serviceSecurityGroup: SecurityGroup
  ) {
    super(scope, name);

    // Create a password stored in the TF State on the fly
    const password = new Password(scope, `${name}-db-password`, {
      length: 16,
      special: false,
    });

    const dbPort = 5432;

    const dbSecurityGroup = new SecurityGroup(scope, "db-security-group", {
      vpcId: vpc.vpcIdOutput,
      ingress: [
        // allow traffic to the DBs port from the service
        {
          fromPort: dbPort,
          toPort: dbPort,
          protocol: "TCP",
          securityGroups: [serviceSecurityGroup.id],
        },
      ],
      tags,
    });

    // Using this module: https://registry.terraform.io/modules/terraform-aws-modules/rds/aws/latest
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

      // This is necessary due to a shortcoming in our token system to be adressed in
      // https://github.com/hashicorp/terraform-cdk/issues/651
      subnetIds: vpc.databaseSubnetsOutput as unknown as any,
      vpcSecurityGroupIds: [dbSecurityGroup.id],
      tags,
    });

    this.instance = db;
  }
}

class MyStack extends TerraformStack {
  constructor(scope: Construct, name: string) {
    // ...
    const db = new PostgresDB(
      this,
      "dockerintegration",
      vpc,
      serviceSecurityGroup
    );
  }
}
```

We create a security group restricted to our service to secure that only our service can talk to the database.
By using the [AWS RDS Terraform module](https://registry.terraform.io/modules/terraform-aws-modules/rds/aws/latest) we can
leverage all the knowledge that went into creating this module and get our Postgres instance.

To deploy the ECS Task we first need to have a docker image pushed. It's up to you if you want to push and deploy it with the CDK or if you want to separate your deployment pipeline from your infrastructure. To me, having everything in one go feels easier and more integrated with the cost that the state gets a bit bigger. So let's see how it can be done within the CDK:

TODO: recopy all examples with classes / scope was changed to this
