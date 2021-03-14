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

const HOSTNAME = "api.cryptomkt.com";

export const handler = async (event: Event) => {
  const { username } = event.requestContext.authorizer;
  const user = await getUserByUsername(username);

  if (!user) {
    return { statusCode: 401 };
  }

  const qsParams = querystring.stringify(event.queryStringParameters);
  const { httpMethod, pathParameters, body } = event;

  let path = `/v2/${pathParameters.proxy}`;
  const parsedBody = body ? JSON.parse(body) : {};

  let headers: { [key: string]: any } = signRequest(user, path, parsedBody);
  if (qsParams) {
    path += `?${qsParams}`;
  }

  let logMessage = `Making ${httpMethod} request to ${HOSTNAME}${path}`;
  let postData: string;

  if (body) {
    postData = querystring.stringify(parsedBody);
    logMessage += ` with body: ${postData}`;
    headers = {
      ...headers,
      "Content-Type": "application/x-www-form-urlencoded",
      "Content-Length": postData.length.toString(),
    };
  }

  console.log(logMessage);
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: HOSTNAME,
        path,
        method: httpMethod,
        headers,
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => {
          const { statusCode } = res;
          console.log(`Response status code: ${statusCode}`);
          resolve({
            statusCode,
            body,
            headers: {
              "Access-Control-Allow-Origin": "*",
            },
          });
        });
      }
    );

    req.on("error", (e) => {
      console.error(`Failed to make request: ${e.message}`);
      reject(e);
    });

    if (postData) {
      req.write(postData);
    }

    req.end();
  });
};
