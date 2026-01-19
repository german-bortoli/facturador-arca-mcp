import type { Page } from 'playwright';
import type { Expense, ID_TYPE } from './interfaces';
import { DateTime } from 'luxon';

const LOGIN_SUFFIX = '/contribuyente_/login.xhtml?action=SYSTEM&system=admin_mono';
const USERNAME = process.env.AFIP_USERNAME!;
const PASSWORD = process.env.AFIP_PASSWORD!;
const CUIT_USR_FACTURADOR = process.env.AFIP_ISSUER_CUIT!;
const BASE_URL = 'https://auth.afip.gob.ar/';
const PORTAL_MONOTRIBUTO_URL = 'https://monotributo.afip.gob.ar/app/Inicio.aspx';
const PORTAL_GENERAL_URL = 'https://portalcf.cloud.afip.gob.ar/portal/app/';

if (!USERNAME || !PASSWORD || !CUIT_USR_FACTURADOR) {
  throw new Error(
    'Username, password and facturador are mandatory, check your env vars'
  );
}

export const addExpensesDataToInvoice = async (
  page: Page,
  expenses: Expense
) => {
  await page.locator('text=Agregar línea descripción').click(); // Adds a new line for adding extra expenses
  await page
    .locator('input[name="detalleCodigoArticulo"]')
    .nth(1)
    .fill(expenses.code);
  await page.locator('#detalle_descripcion2').fill(expenses.description);
  await page.locator('#detalle_cantidad2').fill(expenses.amount);
  await page.locator('#detalle_precio2').fill(expenses.value);
};

export const addAccomodationDataToInvoice = async (
  page: Page,
  expenses: Expense
) => {
  await page.locator('input[name="detalleCodigoArticulo"]').fill(expenses.code); // codigo de articulo;
  await page
    .locator('textarea[name="detalleDescripcion"]')
    .fill(expenses.description); // descripción de articulo;
  await page.locator('input[name="detalleCantidad"]').fill(expenses.amount); // cantidad nominal de articulo;
  await page.locator('input[name="detallePrecio"]').fill(expenses.value); // precio unitario articulo;
};

export const formatNumber = (value: number) => {
  return new Intl.NumberFormat('es-AR', {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  }).format(value);
};

export const startNewInvoice = async (page: Page) => {
  await page
    .locator('a[role="button"]:has-text("Generar Comprobantes")')
    .click();
  if (
    !(await page
      .url()
      .includes('https://fe.afip.gob.ar/rcel/jsp/buscarPtosVtas.do'))
  ) {
    error(new Error('Incorrect page title'));
  }
};

export const sleep = async (page: Page, millis: number) =>
  await page.waitForTimeout(millis || 1000);

export const logInUser = async (page: Page) => {
  const url = await page.url();
  if (
    [PORTAL_MONOTRIBUTO_URL,
      'https://fe.afip.gob.ar/rcel/jsp/index_bis.jsp'
    ]
      .some(loggedUrl => url.includes(loggedUrl))
  ) {
    // Here user should be authed so return;
    Promise.resolve();
  }
  const loginInput = page.locator('input[id="F1:username"]');
  await loginInput.waitFor();
  await loginInput.fill(USERNAME);
  const submitInput = page.locator('input[id="F1:btnSiguiente"]');

  await Promise.all([page.waitForNavigation(), submitInput.click()]);

  const passwordInput = await page.locator('input[name="F1\\:password"]');
  await passwordInput.waitFor();
  await passwordInput.fill(PASSWORD);

  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle' }),
    page.locator('input[alt="Ingresar"]').click(),
  ]);
};

export const navigateToFacturadorPage = async (page: Page, originUrl = BASE_URL + LOGIN_SUFFIX) => {
  await page.goto(originUrl);
  await page.waitForLoadState('networkidle');
  const pageTitle = await page.title();

  if (pageTitle !== 'Portal de Clave Fiscal') {
    if ((pageTitle) === 'Acceso con Clave Fiscal - ARCA') {
      await logInUser(page);
    } else {
      error(new Error(`Incorrect page title: ${pageTitle}`));
    }
  };

  const url = await page.url();

  let portalMonotributoPage: Page = page;
  if (url.includes(PORTAL_GENERAL_URL)) {
    // await page.locator('span:has-text("Mis Servicios")').click();
    const [_portalMonotributoPage] = await Promise.all([
      page.waitForEvent('popup'),
      page.locator('h3:has-text("Monotributo")').click(),
    ]);
    portalMonotributoPage = _portalMonotributoPage;
    const url = await portalMonotributoPage.url();
    if (url.includes('https://monotributo.afip.gob.ar/app/SelecRepresentado.aspx')) {
      await portalMonotributoPage
        .locator(`//a[@usr="${CUIT_USR_FACTURADOR}"]`)
        .click();
    }
  }

  // Url to beign issuing 
  await portalMonotributoPage.waitForURL((url) => {
    const ALLOWED_URLS = [
      'https://monotributo.afip.gob.ar/app/Admin/vRut.aspx',
      PORTAL_MONOTRIBUTO_URL
    ]
    return ALLOWED_URLS.some(allowedUrl => url.href.includes(allowedUrl));
  });

  const [facturadorPage] = await Promise.all([
    portalMonotributoPage.waitForEvent('popup'),
    portalMonotributoPage.locator('text=Emitir Factura').click(),
  ]);

  const authenticatedUrl = 'https://fe.afip.gob.ar/rcel/jsp/index_bis.jsp';
  try {
    await facturadorPage.waitForURL(
      (url) => {
        return !!url.href?.includes(authenticatedUrl);
      },
      { timeout: 15000 }
    );
  } catch (e) {
    // If the authed page is not found, then it means that use is not authenticated so should login.
    // Afip started to share session between popups apparently.
    await logInUser(facturadorPage);
  }

  await facturadorPage.getByRole('button', { name: process.env.RAZON_SOCIAL! }).click();
  return facturadorPage;
};

export const error = async (error: Error) => {
  console.log(error.message);
  console.error(error);
  process.exit(1);
};

export interface CSVRecord {
  MES: string;
  Comprobante: string;
  'N° Comp': string;
  FECHA: string;
  MATRICULA: string;
  HOSPEDAJE: string;
  DESCRIPCION: string;
  SERVICIOS: string;
  TOTAL: string;
  PAGADOR: string;
  RESIDENTE: string;
  'Tipo doc': ID_TYPE;
  Documento: string;
  DIRECCION: string;
}


export const getInvoiceDescription = (concept: string, invoiceDate: string) => {
  let description: string = '';
  if (process.env.GLOBAL_CONCEPT) {
    description = process.env.GLOBAL_CONCEPT;
  }
  if (process.env.ADD_MONTH_TO_CONCEPT === 'true') {
    const date = DateTime.fromFormat(invoiceDate, 'dd/MM/yyyy').setLocale('es').toFormat('MMM yyyy').toUpperCase();
    description += description.length === 0 ? date : ` - ${date}`;
  }
  return description.length > 0 ? `${description} - ${concept}` : concept;
}
