import {
  DataAwsEcrAuthorizationToken,
  EcrRepository,
} from "@cdktf/provider-aws";
import { TerraformAsset } from "cdktf";
import { Construct } from "constructs";
import { RegistryImage } from "./.gen/providers/docker/registry-image";

// Impossible for now due to upstream bug: https://github.com/kreuzwerker/terraform-provider-docker/issues/189
export function DockerApplication(
  scope: Construct,
  name: string,
  path: string
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
  new RegistryImage(scope, p("image"), {
    dependsOn: [repo],
    name: `${repo.repositoryUrl}:${version}`,
    buildAttribute: [
      {
        context: asset.path,
        authConfig: [
          {
            hostName: auth.proxyEndpoint,
            userName: auth.userName,
            password: auth.password,
          },
        ],
      },
    ],
  });
}
