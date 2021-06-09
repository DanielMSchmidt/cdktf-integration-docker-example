import {
  SqlDatabase,
  SqlDatabaseInstance,
  SqlUser,
} from "@cdktf/provider-google";
import * as random from "./.gen/providers/random";
import { Construct } from "constructs";

export function getDb(scope: Construct) {
  return (name: string) => {
    const randomSuffix = new random.Pet(scope, `dbi-${name}-suffix`, {});
    const dbi = new SqlDatabaseInstance(scope, `dbi-${name}`, {
      name: `${name}-${randomSuffix.id}`,
      databaseVersion: "POSTGRES_13",
      deletionProtection: false,
      settings: [
        {
          tier: "db-f1-micro",
        },
      ],
    });

    const createDBUser = (username: string, password: string) => {
      new SqlUser(scope, username, {
        name: username,
        password,
        instance: dbi.name,
        deletionPolicy: "ABANDON",
      });
    };

    const createDb = (name: string) => {
      new SqlDatabase(scope, `db-${name}`, {
        name,
        instance: dbi.name,
      });
    };
    return {
      host: dbi.publicIpAddress,
      createDBUser,
      connectionName: dbi.connectionName,
      createDb,
    };
  };
}
