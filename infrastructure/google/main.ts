import { Construct } from "constructs";
import { App, TerraformOutput, TerraformStack } from "cdktf";
import { hashedAndPushedGCRImage } from "./pushedGCRImage";
import { getSa } from "./sa";
import { DnsManagedZone, GoogleProvider } from "@cdktf/provider-google";
import { resolve } from "path";
import { NullProvider } from "./.gen/providers/null/null-provider";
import { getCloudRun } from "./cloudRun";
import { getDb } from "./db";
import { getStaticFiles } from "./staticFiles";
import { RandomProvider } from "./.gen/providers/random/random-provider";
import { Password } from "./.gen/providers/random/password";
import { Uuid } from "./.gen/providers/random/uuid";

class MyStack extends TerraformStack {
  constructor(scope: Construct, name: string) {
    super(scope, name);
    const project = "dschmidt-cdk-test";

    new NullProvider(this, "null");
    new RandomProvider(this, "random");
    new GoogleProvider(this, "google", {
      zone: "us-central1-c",
      project,
    });

    const sa = getSa(this);
    const gcrImage = hashedAndPushedGCRImage(
      this,
      sa("docker-image-pusher", ["roles/storage.admin"]),
      project
    );
    const cloudRun = getCloudRun(this, "us-central1", project);
    const db = getDb(this);
    const staticFiles = getStaticFiles(this);

    const backend = gcrImage(
      "backend",
      resolve(__dirname, "../../application/backend")
    );
    const dbName = "application";
    const dbUsername = new Uuid(this, "db-user", {}).result;
    const dbPassword = new Password(this, "db-pwd", { length: 24 }).result;
    const dbInstance = db(name);
    dbInstance.createDBUser(dbUsername, dbPassword);
    dbInstance.createDb(dbName);

    const dnsName = "docker-infra-demo.google.cdktf.xyz";
    const zone = new DnsManagedZone(this, "dns", {
      name,
      dnsName: `${dnsName}.`,
    });

    const domainMapping = cloudRun(
      "backend",
      backend,
      `backend.${dnsName}`,
      {
        POSTGRES_HOST: `/cloudsql/${dbInstance.connectionName}`,
        POSTGRES_USER: dbUsername,
        POSTGRES_PASSWORD: dbPassword,
        POSTGRES_PORT: "5432",
        POSTGRES_DB: dbName,
      },
      {
        "run.googleapis.com/cloudsql-instances": dbInstance.connectionName,
      }
    );

    staticFiles(
      "cdktf-integration-example-frontend",
      resolve(__dirname, "../../application/frontend/build"),
      zone
    );

    // https://medium.com/swlh/setup-a-static-website-cdn-with-terraform-on-gcp-23c6937382c6

    new TerraformOutput(this, "backend-ip", {
      value: domainMapping.status("0").resourceRecords,
    });
  }
}

const app = new App();
new MyStack(app, "cdktf-integration-example-google-cloud");
app.synth();
