#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "@aws-cdk/core";

import { CryptoBotStack } from "./stacks/cryptobot-stack";

const app = new cdk.App();
new CryptoBotStack(app, "CryptoBotStack");
