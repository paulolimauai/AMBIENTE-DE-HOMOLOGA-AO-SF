
SET NOCOUNT ON;

IF OBJECT_ID('tempdb..#Relatorio') IS NOT NULL
    DROP TABLE #Relatorio;

CREATE TABLE #Relatorio (
    Banco NVARCHAR(128),
    Esquema NVARCHAR(128),
    Tabela NVARCHAR(128),
    QuantidadeRegistros BIGINT
);

DECLARE @Banco SYSNAME;
DECLARE @SQL NVARCHAR(MAX);

DECLARE Bancos CURSOR LOCAL FAST_FORWARD FOR
SELECT name
FROM sys.databases
WHERE state_desc = 'ONLINE'
  AND database_id > 4
  AND HAS_DBACCESS(name) = 1;

OPEN Bancos;
FETCH NEXT FROM Bancos INTO @Banco;

WHILE @@FETCH_STATUS = 0
BEGIN
    SET @SQL = N'
    USE ' + QUOTENAME(@Banco) + N';

    INSERT INTO #Relatorio
    SELECT
        DB_NAME(),
        s.name,
        t.name,
        SUM(CONVERT(BIGINT, p.rows))
    FROM sys.tables t
    JOIN sys.schemas s
        ON s.schema_id = t.schema_id
    JOIN sys.partitions p
        ON p.object_id = t.object_id
    WHERE p.index_id IN (0, 1)
    GROUP BY s.name, t.name;
    ';

    EXEC sys.sp_executesql @SQL;

    FETCH NEXT FROM Bancos INTO @Banco;
END;

CLOSE Bancos;
DEALLOCATE Bancos;

SELECT
    Banco,
    Esquema,
    Tabela,
    QuantidadeRegistros
FROM #Relatorio
ORDER BY Banco, Esquema, Tabela;

DROP TABLE #Relatorio;
