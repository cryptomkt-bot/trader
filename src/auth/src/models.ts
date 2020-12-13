export interface Response {
  statusCode: number;
  body: string;
  headers?: {
    [key: string]: string;
  };
}
