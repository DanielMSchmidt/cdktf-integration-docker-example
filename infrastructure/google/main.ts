import { Construct } from "constructs";
import { App, TerraformOutput, TerraformStack } from "cdktf";
import { hashedAndPushedGCRImage } from "./pushedGCRImage";
import { getSa } from "./sa";
import { GoogleProvider } from "@cdktf/provider-google";
import { resolve } from "path";
import { NullProvider } from "./.gen/providers/null/null-provider";

class MyStack extends TerraformStack {
  constructor(scope: Construct, name: string) {
    super(scope, name);
    const project = "dschmidt-cdk-test";

    new NullProvider(this, "null");
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

    const tag = gcrImage(
      "backend",
      resolve(__dirname, "../../application/backend")
    );

    new TerraformOutput(this, "backend-tag", {
      value: tag,
    });
  }
}

const app = new App();
new MyStack(app, "google");
app.synth();
