const D1_MAX_SQL_STATEMENT_BYTES = 100_000;
const D1_MAX_ROW_BYTES = 2_000_000;

// Leave room for platform-side parsing overhead while staying below D1's
// documented 100,000-byte SQL statement boundary.
export const DEFAULT_MAX_STATEMENT_BYTES = 90_000;

export function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function sqlValue(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`Cannot encode non-finite SQL number: ${value}`);
    return String(value);
  }
  return sqlString(value);
}

function byteLength(value) {
  return Buffer.byteLength(value, "utf8");
}

function assertStatementSize(statement, maxStatementBytes, context) {
  const size = byteLength(statement);
  if (size > maxStatementBytes) {
    throw new Error(
      `${context} generated a ${size}-byte SQL statement; safe ceiling is ${maxStatementBytes} bytes ` +
        `(D1 limit: ${D1_MAX_SQL_STATEMENT_BYTES} bytes).`,
    );
  }
}

function splitForSqlLiteral(value, maxEncodedBytes) {
  if (maxEncodedBytes < 2) throw new Error("SQL literal chunk budget is too small.");
  const chunks = [];
  let current = "";
  let currentBytes = 0;

  for (const character of value) {
    const encoded = character === "'" ? "''" : character;
    const encodedBytes = byteLength(encoded);
    if (encodedBytes > maxEncodedBytes) {
      throw new Error(`A single encoded character needs ${encodedBytes} bytes; chunk budget is ${maxEncodedBytes}.`);
    }
    if (current && currentBytes + encodedBytes > maxEncodedBytes) {
      chunks.push(current);
      current = "";
      currentBytes = 0;
    }
    current += character;
    currentBytes += encodedBytes;
  }
  if (current || value === "") chunks.push(current);
  return chunks;
}

function insertStatement(table, columns, encodedRows) {
  return `INSERT INTO ${table} (${columns.join(", ")}) VALUES\n${encodedRows.join(",\n")};`;
}

function encodedRow(row) {
  return `(${row.map(sqlValue).join(", ")})`;
}

function rowIdentity(table, columns, row, keyColumns) {
  return keyColumns.map((column) => `${column}=${JSON.stringify(row[columns.indexOf(column)])}`).join(", ");
}

function appendLargeTextStatements({
  table,
  columns,
  row,
  textColumn,
  keyColumns,
  maxStatementBytes,
  maxRowBytes,
}) {
  const textIndex = columns.indexOf(textColumn);
  if (textIndex === -1) throw new Error(`${table} does not contain chunkable column ${textColumn}.`);
  if (!keyColumns?.length) throw new Error(`${table}.${textColumn} needs keyColumns for chunked reconstruction.`);

  const identity = rowIdentity(table, columns, row, keyColumns);
  const approximateRowBytes = row.reduce(
    (total, value) => total + (typeof value === "string" ? byteLength(value) : 8),
    0,
  );
  if (approximateRowBytes > maxRowBytes) {
    throw new Error(
      `${table} row ${identity} is approximately ${approximateRowBytes} bytes; ` +
        `D1 row ceiling is ${maxRowBytes} bytes.`,
    );
  }

  const baseRow = [...row];
  const fullText = String(baseRow[textIndex]);
  baseRow[textIndex] = "";
  const baseInsert = insertStatement(table, columns, [encodedRow(baseRow)]);
  assertStatementSize(baseInsert, maxStatementBytes, `${table} base row ${identity}`);

  const where = keyColumns
    .map((column) => {
      const index = columns.indexOf(column);
      if (index === -1) throw new Error(`${table} key column ${column} is absent.`);
      return `${column} = ${sqlValue(row[index])}`;
    })
    .join(" AND ");
  const prefix = `UPDATE ${table} SET ${textColumn} = ${textColumn} || `;
  const suffix = ` WHERE ${where};`;
  const literalBudget = maxStatementBytes - byteLength(prefix) - byteLength(suffix) - 2;
  const chunks = splitForSqlLiteral(fullText, literalBudget);
  const statements = [baseInsert];
  for (const chunk of chunks) {
    const statement = `${prefix}${sqlString(chunk)}${suffix}`;
    assertStatementSize(statement, maxStatementBytes, `${table} chunk for ${identity}`);
    statements.push(statement);
  }
  return statements;
}

export function buildTableRefreshSql(
  table,
  columns,
  rows,
  {
    maxStatementBytes = DEFAULT_MAX_STATEMENT_BYTES,
    maxRowBytes = D1_MAX_ROW_BYTES,
    largeTextColumn,
    keyColumns,
  } = {},
) {
  if (maxStatementBytes >= D1_MAX_SQL_STATEMENT_BYTES) {
    throw new Error(`Safe SQL ceiling must be below D1's ${D1_MAX_SQL_STATEMENT_BYTES}-byte limit.`);
  }

  const statements = [`DELETE FROM ${table};`];
  let batch = [];

  const flush = () => {
    if (!batch.length) return;
    const statement = insertStatement(table, columns, batch);
    assertStatementSize(statement, maxStatementBytes, `${table} batch`);
    statements.push(statement);
    batch = [];
  };

  for (const row of rows) {
    if (row.length !== columns.length) {
      throw new Error(`${table} row has ${row.length} values for ${columns.length} columns.`);
    }
    const encoded = encodedRow(row);
    const single = insertStatement(table, columns, [encoded]);
    if (byteLength(single) > maxStatementBytes) {
      flush();
      if (!largeTextColumn) {
        throw new Error(`${table} contains a row too large for a safe SQL statement and has no chunkable column.`);
      }
      statements.push(
        ...appendLargeTextStatements({
          table,
          columns,
          row,
          textColumn: largeTextColumn,
          keyColumns,
          maxStatementBytes,
          maxRowBytes,
        }),
      );
      continue;
    }

    const candidate = [...batch, encoded];
    if (batch.length && byteLength(insertStatement(table, columns, candidate)) > maxStatementBytes) {
      flush();
    }
    batch.push(encoded);
  }
  flush();
  return statements.join("\n");
}
