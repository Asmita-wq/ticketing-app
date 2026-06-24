import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { Response } from 'express';

type Row = Record<string, unknown>;

function getColumns(rows: Row[]): string[] {
  if (rows.length === 0) return [];
  return Object.keys(rows[0]);
}

export function exportToCsv(res: Response, filename: string, rows: Row[]) {
  const columns = getColumns(rows);
  const header = columns.join(',');
  const lines = rows.map((row) =>
    columns
      .map((col) => {
        const value = row[col];
        const str = value === null || value === undefined ? '' : String(value);
        return `"${str.replace(/"/g, '""')}"`;
      })
      .join(','),
  );
  const csv = [header, ...lines].join('\n');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
  res.send(csv);
}

export async function exportToExcel(res: Response, filename: string, rows: Row[]) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Report');

  const columns = getColumns(rows);
  sheet.columns = columns.map((col) => ({ header: col, key: col, width: 22 }));
  sheet.getRow(1).font = { bold: true };

  rows.forEach((row) => sheet.addRow(row));

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);

  await workbook.xlsx.write(res);
  res.end();
}

export function exportToPdf(res: Response, filename: string, title: string, rows: Row[]) {
  const doc = new PDFDocument({ margin: 30, size: 'A4', layout: 'landscape' });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.pdf"`);

  doc.pipe(res);

  doc.fontSize(16).text(title, { align: 'center' });
  doc.moveDown();

  const columns = getColumns(rows);
  const colWidth = (doc.page.width - 60) / Math.max(columns.length, 1);

  doc.fontSize(9).font('Helvetica-Bold');
  columns.forEach((col, i) => {
    doc.text(col, 30 + i * colWidth, doc.y, { width: colWidth, continued: false });
  });
  doc.moveDown(0.5);

  doc.font('Helvetica');
  rows.forEach((row) => {
    const y = doc.y;
    columns.forEach((col, i) => {
      const value = row[col];
      const str = value === null || value === undefined ? '' : String(value);
      doc.text(str, 30 + i * colWidth, y, { width: colWidth });
    });
    doc.moveDown(0.3);
    if (doc.y > doc.page.height - 50) doc.addPage({ size: 'A4', layout: 'landscape' });
  });

  doc.end();
}
