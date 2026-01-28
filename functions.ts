import type { Page } from 'playwright';
import type { Expense } from './interfaces';
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
  await page.locator('#detalle_precio2').fill(expenses.value.toString());
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
  await page.locator('input[name="detallePrecio"]').fill(expenses.value.toString()); // precio unitario articulo;
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
  const ptosVtasPage = 'https://fe.afip.gob.ar/rcel/jsp/buscarPtosVtas.do';
  if (
    !(await page.url().includes(ptosVtasPage))
  ) {
    page.goto(ptosVtasPage);
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

export const getInvoiceDescription = (concept: string, invoiceDate: `${string}/${string}/${string}` | Date) => {
  let description: string = '';
  if (process.env.GLOBAL_CONCEPT) {
    description = process.env.GLOBAL_CONCEPT;
  }
  if (process.env.ADD_MONTH_TO_CONCEPT === 'true') {
    const formatted = typeof invoiceDate === 'string' ? DateTime.fromFormat(invoiceDate, 'dd/MM/yyyy') : DateTime.fromJSDate(invoiceDate);
    if (!formatted.isValid) {
      throw new Error(`Invalid date: ${invoiceDate}`);
    }
    const date = formatted.setLocale('es').toFormat('MMM yyyy').toUpperCase();
    description += description.length === 0 ? date : ` - ${date}`;
  }
  return description.length > 0 ? `${concept} - ${description}` : concept;
}


/**
 * Generates a default invoice code based on the invoice index and current month.
 * The code format is: [index part][month part] with at least 4 digits total.
 * 
 * @param index - The current index of the invoice to issue (default: 1)
 * @returns A code string with at least 4 digits: index part (padded to at least 2 digits) + month part (always 2 digits)
 * 
 * @example
 * getCurrentDefaultCode(1) => "0101" (if current month is January)
 * getCurrentDefaultCode(12) => "1212" (if current month is December)
 * getCurrentDefaultCode(103) => "10301" (if current month is January)
 */
export const getCurrentDefaultCode = (index: number = 1) => {
  // Determine the invoice month using the same logic as getInvoicingDate()
  // If day < 14, use previous month; otherwise use current month
  const today = DateTime.now();
  const invoiceDate = today.day < 14
    ? today.minus({ days: today.day })
    : today;

  const month = invoiceDate.month; // 1-12

  // Format index: pad to at least 2 digits, but allow it to grow (01, 12, 103, etc.)
  const indexPart = index.toString().padStart(2, '0');

  // Format month: always 2 digits (01-12)
  const monthPart = month.toString().padStart(2, '0');

  return `${indexPart}${monthPart}`;
}


/**
 * Gets the first day of the month for the given date.
 * 
 * @param date - Date in "dd/MM/yyyy" format or a Date object
 * @returns The first day of the month in "dd/MM/yyyy" format
 * 
 * @example
 * getPeriodFromDate("15/03/2024") => "01/03/2024"
 * getPeriodFromDate(new Date(2024, 2, 15)) => "01/03/2024"
 */
export const getPeriodFromDate = (date: `${string}/${string}/${string}` | Date): `${string}/${string}/${string}` => {
  const dateTime = typeof date === 'string'
    ? DateTime.fromFormat(date, 'dd/MM/yyyy')
    : DateTime.fromJSDate(date);

  if (!dateTime.isValid) {
    throw new Error(`Invalid date: ${date}`);
  }

  const firstDayOfMonth = dateTime.startOf('month');
  return firstDayOfMonth.toFormat('dd/MM/yyyy') as `${string}/${string}/${string}`;
}

/**
 * Gets the last day of the month for the given date.
 * 
 * @param date - Date in "dd/MM/yyyy" format or a Date object
 * @returns The last day of the month in "dd/MM/yyyy" format
 * 
 * @example
 * getPeriodToDate("15/03/2024") => "31/03/2024"
 * getPeriodToDate(new Date(2024, 1, 15)) => "29/02/2024" (leap year)
 */
export const getPeriodToDate = (date: `${string}/${string}/${string}` | Date): `${string}/${string}/${string}` => {
  const dateTime = typeof date === 'string'
    ? DateTime.fromFormat(date, 'dd/MM/yyyy')
    : DateTime.fromJSDate(date);

  if (!dateTime.isValid) {
    throw new Error(`Invalid date: ${date}`);
  }

  const lastDayOfMonth = dateTime.endOf('month');
  return lastDayOfMonth.toFormat('dd/MM/yyyy') as `${string}/${string}/${string}`;
}
