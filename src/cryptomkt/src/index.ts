import * as https from "https";
import * as querystring from "querystring";

import { getUserByUsername } from "../../shared/utils";
import { signRequest } from "./utils";

interface Event {
  httpMethod: string;
  pathParameters: {
    proxy: string;
  };
  queryStringParameters: {
    [key: string]: string;
  };
  body: string;
  requestContext: {
    authorizer: {
      username: string;
    };
  };
}

export const handler = async (event: Event) => {
  const { username } = event.requestContext.authorizer;
  const user = await getUserByUsername(username);

  if (!user) {
    return { statusCode: 401 };
  }

  const qsParams = querystring.stringify(event.queryStringParameters);
  const { httpMethod, pathParameters, body } = event;
  const path = `/v2/${pathParameters.proxy}`;

  const parsedBody = body ? JSON.parse(body) : {};

  let headers: { [key: string]: any } = signRequest(user, path, parsedBody);
  let postData: string;

  if (body) {
    postData = querystring.stringify(parsedBody);
    headers = {
      ...headers,
      "Content-Type": "application/x-www-form-urlencoded",
      "Content-Length": postData.length.toString(),
    };
  }

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "api.cryptomkt.com",
        path: qsParams ? `${path}?${qsParams}` : path,
        method: httpMethod,
        headers,
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => {
          resolve({
            statusCode: res.statusCode,
            body,
            headers: {
              "Access-Control-Allow-Origin": "*",
            },
          });
        });
      }
    );

    req.on("error", (e) => {
      reject(e);
    });

    if (postData) {
      req.write(postData);
    }

    req.end();
  });
};
