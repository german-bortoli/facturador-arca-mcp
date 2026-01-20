export interface Invoice {
  idType: ID_TYPE;
  id: string;
  address: string;
  payerfullName: string;
  resident: string;
  month: string;
  day?: string;
  accomodation: Expense;
  expenses?: Expense;
}

export interface Expense {
  amount: string;
  value: string | number;
  code: string;
  description: string;
}
export enum ID_TYPE {
  DNI = 'DNI',
  CUIT = 'CUIT',
}

export type EXPENSE_CODE = number;

export enum EXPENSE_DESCRIPTION {
  ServicioDeHospedaje = 'Servicio de hospedaje',
  GastosAdministrativos = 'Gastos administrativos',
  MatriculaInscripción = 'Matricula de inscripción',
  Penalidad = 'Penalidad por retiro anticipado',
  Honorarios = 'Honorarios',
  Otros = 'Otros',
}
