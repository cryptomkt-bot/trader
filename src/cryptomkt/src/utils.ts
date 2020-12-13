import { createHmac } from "crypto";

import { User } from "../../shared/models";

export const signRequest = (
  user: User,
  path: string,
  payload: { [key: string]: string } = {}
) => {
  const { ApiKey, ApiSecret } = user;

  const timestamp = Math.floor(Date.now() / 1000);
  let message = timestamp + path;
  Object.keys(payload)
    .sort()
    .forEach((k) => {
      message += payload[k];
    });
  const signature = createHmac("sha384", ApiSecret)
    .update(message)
    .digest("hex");

  return {
    "X-MKT-APIKEY": ApiKey,
    "X-MKT-SIGNATURE": signature,
    "X-MKT-TIMESTAMP": timestamp,
  };
};
