import { getUserByToken } from "../../../shared/utils";

interface Event {
  authorizationToken: string;
  methodArn: string;
}

interface Policy {
  principalId: string;
  policyDocument: {
    Version: "2012-10-17";
    Statement: [
      {
        Action: "execute-api:Invoke";
        Effect: "Allow";
        Resource: string;
      }
    ];
  };
  context: {
    username: string;
  };
}

export const handler = (
  event: Event,
  _: unknown,
  callback: (error: string | null, policy?: Policy) => void
) => {
  getUserByToken(event.authorizationToken).then((user) => {
    if (user) {
      callback(null, {
        principalId: user.UserName,
        policyDocument: {
          Version: "2012-10-17",
          Statement: [
            {
              Action: "execute-api:Invoke",
              Effect: "Allow",
              Resource: "*",
            },
          ],
        },
        context: {
          username: user.UserName,
        },
      });
    } else {
      callback("Unauthorized");
    }
  });
};
