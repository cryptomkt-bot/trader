export interface User {
  UserName: string;
  Password: string;
  Token: string;
  ApiKey: string;
  ApiSecret: string;
  DeviceTokens: Set<string>;
  LatestMessageId: string;
}
