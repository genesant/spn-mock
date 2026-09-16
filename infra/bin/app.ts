#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { PIPELINE, STAGES } from "../lib/config";
import { PipelineStack } from "../lib/pipeline-stack";
import { ServiceStack } from "../lib/service-stack";

const app = new cdk.App();
// `-c bootstrap=true`: create the service with desiredCount 0 (no image in ECR yet).
const bootstrap = app.node.tryGetContext("bootstrap") === "true";

for (const stage of PIPELINE.stages) {
  const cfg = STAGES[stage];
  new ServiceStack(app, `spn-mock-${stage}`, {
    stage,
    cfg,
    bootstrap,
    env: { account: cfg.account, region: cfg.region },
    tags: { project: "spn-mock", stage },
  });
}

new PipelineStack(app, "spn-mock-pipeline", {
  env: { account: PIPELINE.account, region: PIPELINE.region },
  tags: { project: "spn-mock" },
});
