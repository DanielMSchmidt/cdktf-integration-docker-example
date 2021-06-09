import {
  ComputeBackendBucket,
  ComputeGlobalAddress,
  ComputeGlobalForwardingRule,
  ComputeManagedSslCertificate,
  ComputeTargetHttpsProxy,
  ComputeUrlMap,
  DnsManagedZone,
  StorageBucket,
  StorageBucketObject,
  StorageDefaultObjectAccessControl,
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

    const cdn = new ComputeBackendBucket(scope, `cdn-${name}`, {
      name,
      bucketName: bucket.name,
      enableCdn: true,
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

    const map = new ComputeUrlMap(scope, `url-map-${name}`, {
      name,
      defaultService: cdn.selfLink,
    });

    const proxy = new ComputeTargetHttpsProxy(scope, `https-${name}`, {
      name,
      urlMap: map.selfLink,
      sslCertificates: [cert.selfLink],
    });

    new ComputeGlobalForwardingRule(scope, `forwarder-${name}`, {
      name,
      loadBalancingScheme: "EXTERNAL",
      ipAddress: ip.address,
      ipProtocol: "TCP",
      portRange: "443",
      target: proxy.selfLink,
    });
  };
}
