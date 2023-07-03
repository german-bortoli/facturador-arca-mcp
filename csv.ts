import { parse } from 'csv-parse/sync';
import * as fs from 'fs';
import { CSVRecord } from './functions';
import {
  Invoice,
  EXPENSE_CODE,
  EXPENSE_DESCRIPTION,
  ID_TYPE,
} from './interfaces';

// Change filename to desired one to parse

const FILENAME_TO_PARSE = process.env.FILE || 'csv/JUN23.csv';
const yearDigits = String(new Date().getFullYear()).split('20')[1];

(() => {
  let records: CSVRecord[];
  const data = fs.readFileSync(FILENAME_TO_PARSE);
  records = parse(data, {
    columns: true,
    skip_empty_lines: true,
  });

  const mappedRecords = getMappedRecords(records);

  fs.writeFile('csv.json', JSON.stringify(mappedRecords), function (err) {
    if (err) {
      return console.log(err);
    }
    console.log('The file was saved!');
  });
})();

function getMappedRecords(csvRecords: CSVRecord[]): Invoice[] {
  return csvRecords.map((record, index) => {
    const isMatricula = !!record.MATRICULA;
    const mappedData: Invoice = {
      idType: ID_TYPE[record['Tipo doc'] as ID_TYPE] || ID_TYPE.DNI,
      id: record.Documento?.trim(),
      payerfullName: record.PAGADOR?.trim(),
      address: record.DIRECCION?.trim(),
      resident: record.RESIDENTE?.trim(),
      month: record.MES?.trim(),
      day: record.FECHA,
      accomodation: {
        amount: '1',
        value: record.HOSPEDAJE,
        code: isMatricula
          ? EXPENSE_CODE.MatriculaInscripción
          : EXPENSE_CODE.ServicioDeHospedaje,
        description: isMatricula
          ? `${EXPENSE_DESCRIPTION.MatriculaInscripción} ${record.MATRICULA} 20${yearDigits} - ${record.RESIDENTE}`
          : `${EXPENSE_DESCRIPTION.ServicioDeHospedaje} ${record.MES}${yearDigits} - ${record.RESIDENTE}`,
      },
      ...(record.SERVICIOS && {
        expenses: {
          amount: '1',
          value: record.SERVICIOS,
          code: EXPENSE_CODE.GastosAdministrativos,
          description: EXPENSE_DESCRIPTION.GastosAdministrativos,
        },
      }),
    };
    return mappedData;
  });
}
