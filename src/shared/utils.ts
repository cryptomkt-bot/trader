import { DynamoDB } from "aws-sdk";

import { User } from "./models";

const { USERS_TABLE_NAME = "", REGION } = process.env;

const getUsers = async (
  docClient?: DynamoDB.DocumentClient
): Promise<User[]> => {
  if (!docClient) {
    docClient = new DynamoDB.DocumentClient({
      service: new DynamoDB({ region: REGION }),
    });
  }

  const qs = await docClient
      .scan({
	TableName: USERS_TABLE_NAME,
	ConsistentRead: true
      })
      .promise();

  return qs.Items as User[];
};

export const getUserByUsername = async (
  username: string,
  docClient?: DynamoDB.DocumentClient
): Promise<User | undefined> => {
  const users = await getUsers(docClient);

  return users.find((user) => user.UserName === username);
};

export const getUserByToken = async (
  token: string,
  docClient?: DynamoDB.DocumentClient
): Promise<User | undefined> => {
  const users = await getUsers(docClient);

  return users.find((user) => user.Token === token);
};
