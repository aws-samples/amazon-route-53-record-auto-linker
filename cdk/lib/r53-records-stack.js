// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

const core = require('@aws-cdk/core');
const iam = require('@aws-cdk/aws-iam');
const s3 = require('@aws-cdk/aws-s3');
const ssm = require('@aws-cdk/aws-ssm');
const logs = require("@aws-cdk/aws-logs");
const events = require('@aws-cdk/aws-events');
const lambda = require('@aws-cdk/aws-lambda');
const trail = require('@aws-cdk/aws-cloudtrail');
const dynamodb = require('@aws-cdk/aws-dynamodb');
const targets = require('@aws-cdk/aws-events-targets');

class R53RecordsStack extends core.Stack {
    constructor(scope) {
        super(scope, "R53-Records");

        const bucket = this.bucket();
        this.parameter(bucket);
        this.dynamodb();
        this.cloudtrail(bucket);
        this.events(this.lambda());
    }

    bucket() {
        return new s3.Bucket(this, "Bucket", {
           autoDeleteObjects: true,
           removalPolicy: core.RemovalPolicy.DESTROY
       });
    }

    parameter(bucket) {
        new ssm.StringParameter(this, "BucketName", {
            parameterName: "/r53linker/bucket",
            stringValue: bucket.bucketName,
            description: "The common bucket name"
        });
    }

    dynamodb() {
        return new dynamodb.Table(this, "Table", {
            tableName: "Route53Records",
            removalPolicy: core.RemovalPolicy.DESTROY,
            partitionKey: {
                name: "id",
                type: dynamodb.AttributeType.STRING
            }
        });
    }

    cloudtrail(bucket) {
        new trail.Trail(this, "Trail", {
            bucket: bucket,
            s3KeyPrefix: "trail",
            isMultiRegionTrail: false,
        });
    }

    events(updateFunction) {
        new events.Rule(this, "ec2", {
            ruleName: "R53-Records-EC2",
            description: "Register a record to its private IP address",
            eventPattern: {
                source: [ "aws.ec2" ],
                detailType: [ "AWS API Call via CloudTrail" ],
                detail: {
                    "eventSource": [ "ec2.amazonaws.com" ],
                    "eventName": [
                        "RunInstances",
                        "TerminateInstances",
                        "CreateTags",
                        "DeleteTags"
                    ]
                }
            },
            targets: [ new targets.LambdaFunction(updateFunction) ]
        });

        new events.Rule(this, "elb", {
            ruleName: "R53-Records-ELB",
            description: "Register an alias record to its DNS name",
            eventPattern: {
                source: [ "aws.elasticloadbalancing" ],
                detailType: [ "AWS API Call via CloudTrail" ],
                detail: {
                    "eventSource": [ "elasticloadbalancing.amazonaws.com" ],
                    "eventName": [
                        "CreateLoadBalancer",
                        "DeleteLoadBalancer",
                        "AddTags",
                        "RemoveTags"
                    ]
                }
            },
            targets: [ new targets.LambdaFunction(updateFunction) ]
        });
    }

    lambda() {
        const role = new iam.Role(this, "Role", {
            assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
            managedPolicies: [
                iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaBasicExecutionRole"),
                iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonDynamoDBFullAccess"),
                iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonEc2ReadOnlyAccess"),
                iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonRoute53FullAccess"),
                iam.ManagedPolicy.fromAwsManagedPolicyName("ElasticLoadBalancingReadOnly")
            ]
        });

        return new lambda.Function(this, "Function", {
            functionName: "R53-UpdateRecords",
            handler: "update-records.handler",
            role: role,
            runtime: lambda.Runtime.NODEJS_12_X,
            timeout: core.Duration.minutes(5),
            logRetention: logs.RetentionDays.ONE_MONTH,
            description: "Update Route53 records.",
            code: lambda.Code.fromAsset("../lambda/r53")
        });
    }
}

module.exports = { R53RecordsStack }
