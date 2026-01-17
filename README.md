## AFIP simple facturador

This is a simple app made with palywright that issues invoices using structured data from a csv file. The CSV file in this example is for a lodging business, but can be amended to fit any other business needs. `csv.ts` contrains logic & `interfaces.ts` contains types for better DX.

## Instructions

1. Make sure you have the following env vars:

```
   AFIP_USERNAME=username
   AFIP_PASSWORD=password
   AFIP_ISSUER_CUIT=20123456789
   RAZON_SOCIAL="PEPITO SRL"
   FILE=filename.csv
```

2. You need to create a comma delimited csv file to feed the `csv.ts` and amend it to fit your business needs.
3. Run "yarn" to install dependencies
4. Run "yarn csv" command to generate required "csv.json" file with parsed data that will be used to run the script & issue each invoice.
5. Run "yarn invoices" to issue all required invoices
6. Alternatively you can run `yarn debug` to run playwright in debug mode and monitor the whole process in headed mode.

#### Notes

`app.ts` file contains the required logic with playwright locators & actions to issue invoices.
