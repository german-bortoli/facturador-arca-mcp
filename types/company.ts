/**
 * Company information required for invoice generation
 */
export interface CompanyInfo {
  /**
   * Company display name (e.g., "Empresa imaginaria S.A.")
   */
  name: string;

  /**
   * Legal company name / Razón social
   */
  legalName: string;

  /**
   * Company address / Domicilio Comercial
   */
  address: string;

  /**
   * Tax status / Condición Frente al IVA
   * (e.g., "Responsable inscripto", "Monotributista", etc.)
   */
  taxStatus: string;

  /**
   * Company CUIT number
   */
  cuit: string;

  /**
   * Ingresos Brutos registration number
   */
  ingresosBrutos: string;

  /**
   * Start date of activities / Fecha de Inicio de Actividades
   * Format: DD/MM/YYYY
   */
  startDate: string;
}

/**
 * Validates that all required company information is present
 * @param companyInfo - Company information to validate
 * @throws Error if any required field is missing
 */
export function validateCompanyInfo(companyInfo: Partial<CompanyInfo>): asserts companyInfo is CompanyInfo {
  const requiredFields: Array<keyof CompanyInfo> = [
    'name',
    'legalName',
    'address',
    'taxStatus',
    'cuit',
    'ingresosBrutos',
    'startDate',
  ];
  const missingFields: string[] = [];

  for (const field of requiredFields) {
    if (!companyInfo[field] || String(companyInfo[field]).trim() === '') {
      missingFields.push(field);
    }
  }

  if (missingFields.length > 0) {
    throw new Error(
      `Missing required company information: ${missingFields.join(', ')}. ` +
      'Please set all required COMPANY_* environment variables.'
    );
  }
}
