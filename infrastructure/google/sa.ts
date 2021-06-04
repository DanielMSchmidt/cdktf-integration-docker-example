import { ProjectIamMember, ServiceAccount } from "@cdktf/provider-google";
import { Construct } from "constructs";
export function getSa(scope: Construct) {
  return (name: string, roles: string[]) => {
    const account = new ServiceAccount(scope, `sa-${name}`, {
      accountId: name,
      displayName: name,
    });

    roles.forEach((role) => {
      new ProjectIamMember(scope, `projectMember-${name}-${role}`, {
        role,
        member: `serviceAccount:${account.email}`,
      });
    });

    return account;
  };
}
