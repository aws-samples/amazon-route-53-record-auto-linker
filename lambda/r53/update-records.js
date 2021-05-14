// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

const AWS = require('aws-sdk');
const ec2 = new AWS.EC2();
const elbv2 = new AWS.ELBv2();
const route53 = new AWS.Route53();
const dynamodb = new AWS.DynamoDB.DocumentClient();

const DEFAULT_TTL = 300;
const TAG_KEY = "bcs:route53:record";

class HostedZone {
    zone;
    constructor(dnsName) {
        this.dnsName = dnsName;
    }

    async load() {
        const data = await route53.listHostedZonesByName({DNSName: this.dnsName}).promise();
        this.zone = data.HostedZones[0];
    }

    get id() {
        return this.zone.Id;
    }
}

class RecordTable {
    static TABLE_NAME = "Route53Records";

    async getItem(id) {
        const item = await dynamodb.get({
            TableName: RecordTable.TABLE_NAME,
            Key: {"id": id}
        }).promise();
        return item ? item.Item : null;
    }

    async update(id, alias, object) {
        await dynamodb.put({
            TableName: RecordTable.TABLE_NAME,
            Item: {
                "id": id,
                "alias": alias,
                "object": object
            }
        }).promise();
    };

    async remove(id) {
        await dynamodb.delete({
            TableName: RecordTable.TABLE_NAME,
            Key: {"id": id}
        }).promise();
    }
}

const table = new RecordTable();

class Ec2Handler {
    instance;
    constructor(instanceId) {
        this.instanceId = instanceId;
    }

    async load() {
        const data = await ec2.describeInstances({InstanceIds: [this.instanceId]}).promise();
        this.instance = data.Reservations[0].Instances[0];
    }

    async updateRecords(zoneId, alias, upsert) {
        const ttl = DEFAULT_TTL;
        const changeBatch = [{
            Action: upsert ? "UPSERT" : "DELETE",
            ResourceRecordSet: {
                Type: "A",
                TTL: ttl,
                Name: alias,
                ResourceRecords: [{ Value: this.instance.PrivateIpAddress }]
            }
        }];

        if (upsert) {
            await table.update(this.instance.InstanceId, alias, this.instance);
        } else {
            await table.remove(this.instance.InstanceId);
        }

        console.log("Update EC2 record: " + JSON.stringify(changeBatch) + " at zone " + zoneId);
        const data = await route53.changeResourceRecordSets({
            HostedZoneId: zoneId,
            ChangeBatch: {Changes: changeBatch}
        }).promise();
        console.log("Change ID: " + data.ChangeInfo.Id);
    }
}

class ElbHandler {
    lb;
    constructor(lbArn) {
        this.lbArn = lbArn;
    }

    async load() {
        const data = await elbv2.describeLoadBalancers({LoadBalancerArns: [this.lbArn]}).promise();
        this.lb = data.LoadBalancers[0];
    }

    async updateRecords(zoneId, alias, upsert) {
        const changeBatch = [{
            Action: upsert ? "UPSERT" : "DELETE",
            ResourceRecordSet: {
                Type: "A",
                Name: alias,
                AliasTarget: {
                    HostedZoneId: this.lb.CanonicalHostedZoneId,
                    DNSName: (this.lb.Type == "application" ? "dualstack." : "") + this.lb.DNSName + ".",
                    EvaluateTargetHealth: true
                }
            }
        }];

        if (upsert) {
            await table.update(this.lb.LoadBalancerArn, alias, this.lb);
        } else {
            await table.remove(this.lb.LoadBalancerArn);
        }

        console.log("Change LB batch: " + JSON.stringify(changeBatch));
        const data = await route53.changeResourceRecordSets({
            HostedZoneId: zoneId,
            ChangeBatch: {Changes: changeBatch}
        }).promise();
        console.log("Change ID: " + data.ChangeInfo.Id);
    }
}

exports.handler = async function(event) {
    console.log("Event: " + JSON.stringify(event));

    switch (event.source) {
        case "aws.ec2":
            await processEc2(event.detail);
            break;

        case "aws.elasticloadbalancing":
            await processElb(event.detail);
            break;
    }
};

function getDomain(url) {
    return url.substring(url.indexOf(".") + 1);
}

function findEntry(tags) {
    return tags ? tags.filter(tag => tag.key == TAG_KEY).pop() : null;
}

function findKey(tags) {
    return tags ? tags.filter(tag => tag == TAG_KEY).pop() : null;
}

async function processEc2(detail) {
    const parameters = detail.requestParameters;
    var zone;
    var entry;
    var handler;
    var instanceId;

    switch (detail.eventName) {
        case "RunInstances":
            if (!parameters.tagSpecificationSet) {
                return;
            }
            entry = findEntry(parameters.tagSpecificationSet.items[0].tags);
            if (!entry) {
                return;
            }
            instanceId = detail.responseElements.instancesSet.items[0].instanceId;
            handler = new Ec2Handler(instanceId);
            await handler.load();

            zone = new HostedZone(getDomain(entry.value));
            await zone.load();
            await handler.updateRecords(zone.id, entry.value, true);
            break;

        case "TerminateInstances":
            instanceId = parameters.instancesSet.items[0].instanceId;
            const item = await table.getItem(instanceId);
             if (!item) {
                return;
            }
            zone = new HostedZone(getDomain(item.alias));
            await zone.load();

            handler = new Ec2Handler(item.object.InstanceId);
            handler.instance = item.object;
            await handler.updateRecords(zone.id, item.alias, false);
            break;

        case "CreateTags":
        case "DeleteTags":
            entry = findEntry(parameters.tagSet.items);
            if (!entry) {
                return;
            }
            instanceId = parameters.resourcesSet.items[0].resourceId;
            handler = new Ec2Handler(instanceId);
            await handler.load();

            zone = new HostedZone(getDomain(entry.value));
            await zone.load();
            await handler.updateRecords(zone.id, entry.value, detail.eventName == "CreateTags");
            break;
    }
}

async function processElb(detail) {
    const parameters = detail.requestParameters;
    var zone;
    var entry;
    var handler;
    var lbArn;
    var item;

    switch (detail.eventName) {
        case "CreateLoadBalancer":
            entry = findEntry(parameters.tags);
            if (!entry) {
                return;
            }
            lbArn = detail.responseElements.loadBalancers[0].loadBalancerArn;
            handler = new ElbHandler(lbArn);
            await handler.load();

            zone = new HostedZone(getDomain(entry.value));
            await zone.load();
            await handler.updateRecords(zone.id, entry.value, true);
            break;

        case "DeleteLoadBalancer":
            lbArn = parameters.loadBalancerArn;
            item = await table.getItem(lbArn);
            if (!item) {
                return;
            }
            zone = new HostedZone(getDomain(item.alias));
            await zone.load();

            handler = new ElbHandler(lbArn);
            handler.lb = item.object;
            await handler.updateRecords(zone.id, item.alias, false);
            break;

        case "AddTags":
            entry = findEntry(parameters.tags);
            if (!entry) {
                return;
            }
            lbArn = parameters.resourceArns[0];
            handler = new ElbHandler(lbArn);
            await handler.load();

            zone = new HostedZone(getDomain(entry.value));
            await zone.load();
            await handler.updateRecords(zone.id, entry.value, true);
            break;

        case "RemoveTags":
            entry = findKey(parameters.tagKeys);
            if (!entry) {
                return;
            }
            lbArn = parameters.resourceArns[0];
            item = await table.getItem(lbArn);
            zone = new HostedZone(getDomain(item.alias));
            await zone.load();

            handler = new ElbHandler(lbArn);
            handler.lb = item.object;
            await handler.updateRecords(zone.id, item.alias, false);
            break;
    }
}
