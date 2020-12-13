import { compare } from "bcrypt";

import { Response } from "../models";
import { getUserByUsername } from "../../../shared/utils";

interface EventBody {
  username: string;
  password: string;
}

interface Event {
  body: string;
  headers: string;
}

const response = (statusCode: number, body: any): Response => {
  return {
    statusCode,
    body: JSON.stringify(body),
    headers: {
      "Access-Control-Allow-Origin": "*",
    },
  };
};

export const handler = async (event: Event): Promise<Response> => {
  const body: EventBody = JSON.parse(event.body);
  const user = await getUserByUsername(body.username);

  if (user) {
    const isPasswordOk = await compare(body.password, user.Password);

    if (isPasswordOk) {
      return response(200, user.Token);
    }
  }

  return response(401, "Wrong username or password");
};
