import { TerraformStack, Testing } from "cdktf";
import { PushedECRImage, Cluster, PublicS3Bucket } from "../main";
import * as path from "path";
import { EcsCluster, EcsTaskDefinition } from "@cdktf/provider-aws";

describe("PushedECRImage", () => {
  it("can be planned", () => {
    const app = Testing.app();
    const stack = new TerraformStack(app, "testing");
    const { tag } = PushedECRImage(
      stack,
      "my-ecr-image",
      path.resolve(__dirname, "..")
    );
    expect(stack).toPlanSuccessfully();
    expect(tag).toMatchInlineSnapshot();
  });
});

describe("Cluster", () => {
  it("creats a cluster", () => {
    expect(
      Testing.synthScope((scope) => new Cluster(scope, "my-cluster"))
    ).toHaveResource(EcsCluster);
  });

  it("can run docker images", () => {
    const synthedOutput = Testing.synthScope((scope) => {
      const cluster = new Cluster(scope, "my-cluster");
      cluster.runDockerImage("my-image", "tag", "image", { myEnv: "yes" });
    });
    expect(synthedOutput).toHaveResource(EcsTaskDefinition);
    expect(synthedOutput).toMatchSnapshot();
  });
});

describe("PublicS3Bucket", () => {
  it("expose files in public s3 bucket", () => {
    expect(
      Testing.synthScope(
        (scope) =>
          new PublicS3Bucket(scope, "s3", path.resolve(__dirname, "fixtures"))
      )
    ).toMatchInlineSnapshot();
  });
});
