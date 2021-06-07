import { ServiceAccount, ServiceAccountKey } from "@cdktf/provider-google";
import { TerraformAsset } from "cdktf";
import { Construct } from "constructs";
import { Resource } from "./.gen/providers/null/resource";

export function pushedGCRImage(scope: Construct, sa: ServiceAccount) {
  const { privateKey } = new ServiceAccountKey(scope, `key-${sa.email}`, {
    serviceAccountId: sa.email,
  });

  return (tag: string, path: string) => {
    const image = new Resource(scope, `dockerimage-${tag}`, {
      triggers: {
        tag,
      },
    });

    const cmd = `echo '${privateKey}' | base64 -D | docker login -u _json_key --password-stdin https://gcr.io && docker build -t ${tag} ${path} && docker push ${tag}`;
    image.addOverride("provisioner.local-exec.command", cmd);
    return image;
  };
}

export function hashedGCRImage(
  scope: Construct,
  pusher: (tag: string, path: string) => Resource,
  projectName: string
) {
  return (imageName: string, originalPath: string): [string, Resource] => {
    const { path, assetHash } = new TerraformAsset(
      scope,
      `image-context-${imageName}`,
      {
        path: originalPath,
      }
    );

    const tag = `gcr.io/${projectName}/${imageName}:${assetHash}`;
    const resource = pusher(tag, path);
    return [tag, resource];
  };
}

export const hashedAndPushedGCRImage = (
  scope: Construct,
  sa: ServiceAccount,
  projectName: string
) => hashedGCRImage(scope, pushedGCRImage(scope, sa), projectName);
