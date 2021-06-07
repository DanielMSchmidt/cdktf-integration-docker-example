import {
  ComputeGlobalAddress,
  StorageBucket,
  StorageBucketObject,
  StorageDefaultObjectAccessControl,
} from "@cdktf/provider-google";
import { TerraformAsset } from "cdktf";
import { Construct } from "constructs";
import { sync as glob } from "glob";
import * as path from "path";

export function getStaticFiles(scope: Construct) {
  return (name: string, contentPath: string) => {
    const asset = new TerraformAsset(scope, `files-${name}`, {
      path: contentPath,
    });

    const bucket = new StorageBucket(scope, `bucket-${name}`, {
      name,
    });
    new StorageDefaultObjectAccessControl(scope, `ac-${name}-read-all`, {
      bucket: bucket.name,
      role: "READER",
      entity: "allUsers",
    });

    const files = glob("**/*.{json,js,html,png,ico,txt,map}", {
      cwd: contentPath,
    });

    files.forEach((relativeFilePath) => {
      new StorageBucketObject(
        scope,
        `bucket-${name}-object-${relativeFilePath}`,
        {
          bucket: bucket.name,
          name: relativeFilePath,
          source: path.join(asset.path, relativeFilePath),
        }
      );
    });

    return new ComputeGlobalAddress(scope, `lb-ip-${name}`, { name });
  };
}
