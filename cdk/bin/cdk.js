#!/usr/bin/env node

// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

const { App } = require('@aws-cdk/core');
const { R53RecordsStack } = require('../lib/r53-records-stack.js');

const app = new App();
new R53RecordsStack(app);
