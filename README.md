# Route53RecordAutoLinker

## Introduction
For AWS beginners, there are many challenges in efficiently managing Amazon Route 53 hosted zone record sets. 
When the hosted zone contains a record, the console "Import Zone File" button becomes unavailable, which increases the difficulty of batch import. 
In addition, when the associated resources of the record (such as instance, load balancer, etc.) change, the record itself will not be linked, 
resulting in inconsistent information and increasing maintenance difficulty. 
This project aims at how to automate the management and maintenance of the managed zone record set. 
The main idea is to track the change events of related resources (create resources, delete resources, add tags, delete tags, etc.), 
automatically modify the hosted zone records and keep them consistent with the resources, reduce operation and maintenance pressure, and improve efficiency and accuracy.

### AWS Blog
An article was published in AWS Blog to introduce the solution in detail.
- https://aws.amazon.com/cn/blogs/china/use-tracking-events-to-establish-a-linkage-mechanism-between-resources-and-managed-zone-records/

## Deployment
CDK is used as the infrastructure as code solution.
A script file named `deploy.sh` is provided to facilitate the resource provisioning process.
To deploy the AWS resources, export the following three environmental properties and run the script.
```bash
export AWS_ACCOUNT=
export REGION=cn-north-1
export PROFILE=

cd cdk
./bash/deploy.sh
```

The project is ready and running after deployment by monitoring CloudTrail events.
To destroy all the resources, run:
```bash
cd cdk
./bash/deploy.sh -a destroy
```
