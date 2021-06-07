import { Construct } from "constructs";
import {
  CloudRunDomainMapping,
  CloudRunService,
  CloudRunServiceIamPolicy,
  DataGoogleIamPolicy,
} from "@cdktf/provider-google";
import { Resource } from "./.gen/providers/null/resource";

export function getCloudRun(
  scope: Construct,
  location: string,
  namespace: string
) {
  return (
    name: string,
    image: [string, Resource],
    domain: string,
    env: Record<string, string>,
    annotations: Record<string, string>
  ) => {
    const [tag, resource] = image;
    const svc = new CloudRunService(scope, `crs-${name}`, {
      dependsOn: [resource],
      location,
      name,
      metadata: [{ namespace, annotations }],
      template: [
        {
          metadata: [{ annotations }],
          spec: [
            {
              containers: [
                {
                  image: tag,
                  env: Object.entries(env).map(([k, v]) => ({
                    name: k,
                    value: v,
                  })),
                },
              ],
            },
          ],
        },
      ],
      traffic: [
        {
          percent: 100,
          latestRevision: true,
        },
      ],
    });

    const policy = new DataGoogleIamPolicy(scope, `data-iam-policy-${name}`, {
      binding: [
        {
          members: ["allUsers"],
          role: "roles/run.invoker",
        },
      ],
    });

    new CloudRunServiceIamPolicy(scope, `cr-iam-policy-${name}`, {
      location,
      service: svc.name,
      policyData: policy.policyData,
    });

    return new CloudRunDomainMapping(scope, `crdm-${name}`, {
      location,
      name: domain,
      metadata: [{ namespace }],
      spec: [
        {
          routeName: svc.name,
        },
      ],
    });
  };
}
