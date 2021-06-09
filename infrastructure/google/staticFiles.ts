import {
  ComputeBackendBucket,
  ComputeGlobalAddress,
  ComputeGlobalForwardingRule,
  ComputeManagedSslCertificate,
  ComputeTargetHttpProxy,
  ComputeTargetHttpsProxy,
  ComputeUrlMap,
  DataGoogleIamPolicy,
  DnsManagedZone,
  StorageBucket,
  StorageBucketAccessControl,
  StorageBucketIamPolicy,
  StorageBucketObject,
} from "@cdktf/provider-google";
import { TerraformAsset } from "cdktf";
import { Construct } from "constructs";
import { sync as glob } from "glob";
import * as path from "path";
import { DnsRecordSet } from "@cdktf/provider-google";

export function getStaticFiles(scope: Construct) {
  return (name: string, contentPath: string, zone: DnsManagedZone) => {
    const asset = new TerraformAsset(scope, `files-${name}`, {
      path: contentPath,
    });

    const ip = new ComputeGlobalAddress(scope, `lb-ip-${name}`, { name });

    const dnsRecord = new DnsRecordSet(scope, `dns-${name}-${zone.dnsName}`, {
      name: zone.dnsName, //TODO: pass in (could be subdomain)
      type: "A",
      ttl: 300,
      managedZone: zone.name,
      rrdatas: [ip.address],
    });

    const cert = new ComputeManagedSslCertificate(
      scope,
      `ssl-${name}-${zone.dnsName}`,
      {
        name,
        managed: [
          {
            domains: [dnsRecord.name],
          },
        ],
      }
    );

    const bucket = new StorageBucket(scope, `bucket-${name}`, {
      name,
      website: [
        {
          mainPageSuffix: "index.html",
        },
      ],
      cors: [
        {
          origin: [dnsRecord.name],
          method: ["GET", "HEAD", "PUT", "POST", "DELETE"],
          responseHeader: ["*"],
        },
      ],
    });
    const files = glob("**/*.{json,js,html,png,ico,txt,map}", {
      cwd: contentPath,
    });

    // https://github.com/MatthewCYLau/react-terraform-gcp-cloud-build
    const viewerPolicy = new DataGoogleIamPolicy(
      scope,
      `reader-policy-${name}`,
      {
        binding: [
          {
            role: "roles/storage.objectViewer",
            members: ["allUsers"],
          },
        ],
      }
    );
    new StorageBucketIamPolicy(scope, `bucket-iam-policy-${name}`, {
      bucket: bucket.name,
      policyData: viewerPolicy.policyData,
    });

    new StorageBucketAccessControl(scope, `ac-${name}-read-all`, {
      bucket: bucket.name,
      role: "READER",
      entity: "allUsers",
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

    const cdn = new ComputeBackendBucket(scope, `cdn-${name}`, {
      name,
      bucketName: bucket.name,
      enableCdn: true,
    });

    const map = new ComputeUrlMap(scope, `url-map-${name}`, {
      name,
      defaultService: cdn.id,
      hostRule: [
        {
          hosts: [dnsRecord.name],
          pathMatcher: name,
        },
      ],
      pathMatcher: [
        {
          name,
          defaultService: cdn.id,
          // TODO: add backend path here
          pathRule: [
            {
              paths: ["/"],
              service: cdn.id,
            },
          ],
        },
      ],
    });

    const httpsProxy = new ComputeTargetHttpsProxy(scope, `https-${name}`, {
      name,
      urlMap: map.selfLink,
      sslCertificates: [cert.selfLink],
    });
    const httpProxy = new ComputeTargetHttpProxy(scope, `http-${name}`, {
      name,
      urlMap: map.selfLink,
    });

    new ComputeGlobalForwardingRule(scope, `forwarder-${name}-https`, {
      name: `${name}-https`,
      loadBalancingScheme: "EXTERNAL",
      ipAddress: ip.address,
      ipProtocol: "TCP",
      portRange: "443",
      target: httpsProxy.selfLink,
    });
    new ComputeGlobalForwardingRule(scope, `forwarder-${name}-http`, {
      name: `${name}-http`,
      loadBalancingScheme: "EXTERNAL",
      ipAddress: ip.address,
      ipProtocol: "TCP",
      portRange: "80",
      target: httpProxy.selfLink,
    });
  };
}
