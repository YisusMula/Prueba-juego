# Valores de referencia y su fuente

Todos los valores que trae EnRegla son **orientativos**: sirven para avisar y pedir una acción correctora, no garantizan el cumplimiento de la normativa. Cada local los puede cambiar (equipos, proveedores, Ajustes → Datos y recordatorios → Valores de referencia, y registros personalizados) para que coincidan con su plan de autocontrol, que es lo que manda.

Fuentes consultadas el 27 de noviembre de 2026. En el código, cada valor cita su fuente junto a la constante (`server/src/schemas/references.ts`, `server/src/schemas/index.ts`, `server/src/modules/orgs/templates.ts`).

## Fuentes

| Clave | Documento | Enlace |
|---|---|---|
| RD1086 | Real Decreto 1086/2020, art. 30 «Requisitos para los establecimientos de comidas preparadas», texto consolidado (el RD 1021/2022, disposición final 2.12, solo modificó el apartado 11) | https://www.boe.es/buscar/act.php?id=BOE-A-2020-15872 |
| AND | «Requisitos simplificados de higiene: guía orientativa para la implantación del sistema de autocontrol en ciertos establecimientos alimentarios», Consejería de Salud de la Junta de Andalucía, 2.ª ed., 2010 (apartado de cocinado) | https://cdn.juntadeandalucia.es/export/drupaljda/salud_5aeb2cc7219a1_guia_higiene_04.pdf |
| AESAN | Agencia Española de Seguridad Alimentaria y Nutrición, «Prevenir intoxicaciones alimentarias en verano» (consejos de cocinado) | https://www.aesan.gob.es/AECOSAN/web/noticias_y_actualizaciones/temas_de_interes/campania_verano.htm |
| RD3 | Real Decreto 3/2023 (agua de consumo): art. 36.6 y anexo I, parte C, parámetro 45 | https://www.boe.es/buscar/act.php?id=BOE-A-2023-628 |
| EUS | Plan genérico de autocontrol en hostelería, Gobierno Vasco (fichas «Temperatura de cocinado», «Regeneración», «Enfriamiento de alimentos cocinados en abatidor», «Mantenimiento en caliente», «Control del agua», «Aceite de fritura»; registros de al menos 12 meses) | https://www.euskadi.eus/contenidos/informacion/comedores_colectivos/es_def/adjuntos/Plan-generico-hosteleria.pdf |
| VAL | Criterios de autocontrol en establecimientos de comidas preparadas, Conselleria de Sanitat (Comunitat Valenciana), rev. 2, 2013 (Regeneración; Control del enfriamiento; Plan de control del agua; Programa de verificación/calibración de equipos de medida) | https://seguridadycalidadalimentaria.fundacionusal.es/wp-content/uploads/guias/restauracion/criterios_autocontrol_establecimientos_comidas_preparadas_Valencia.pdf |
| MAD | Comunidad de Madrid, «¿Qué requisitos deben cumplir los restaurantes, los bares o los comedores de empresa?» | https://www.comunidad.madrid/salud/quiero-montar-restaurante-requisitos-sanitarios-debo-cumplir |

## Valores

| Valor | En EnRegla (por defecto) | Fuente y texto | Otras referencias |
|---|---|---|---|
| Cocinado: temperatura mínima en el centro | **70 °C** (configurable 65–100 °C) | AND: «se recomienda alcanzar siempre los 70ºC en el interior de las piezas (75ºC si se utilizan huevos frescos)». AESAN: «un mínimo de 70 °C en el centro del producto, al menos durante 2 minutos» | Como contexto: EUS usa 65 °C en el centro («Temperatura de cocinado»); por eso el mínimo configurable es 65 °C. La normativa estatal no fija una cifra general; MAD da 60 °C solo para el pescado (anisakis) |
| Cocinado con huevo fresco | **75 °C** (configurable 70–100 °C); se aplica al marcar «Lleva huevo fresco» | AND: «75ºC si se utilizan huevos frescos» | — |
| Regeneración (recalentamiento): temperatura mínima en el centro | **74 °C** (configurable 70–100 °C) | RD1086 art. 30.7: «al menos 74 °C durante al menos 15 segundos», en la hora siguiente a sacarlas del frigorífico; admite temperaturas inferiores con efecto equivalente. MAD: igual | EUS: 70 °C; VAL: 65 °C |
| Enfriamiento rápido: temperatura final | **10 °C o menos** (configurable 0–15 °C) | RD1086 art. 30.6: «de 60 °C a 10 °C en menos de dos horas». EUS y VAL (abatidor): «menos de 10 ºC en dos horas». MAD: igual, «y seguir disminuyendo hasta los 4 °C» | Después, conservación ≤ 4 °C (art. 30.3) |
| Enfriamiento rápido: tiempo máximo | **120 min** (configurable 30–360 min); llegar justo a 120 min ya no cumple («en menos de») | RD1086 art. 30.6 | Un enfriamiento empezado y sin cerrar pasado este tiempo cuenta como alerta sin acción y como tarea sin registrar |
| Enfriamiento rápido: temperatura de partida | **60 °C** (configurable 50–75 °C). Si el inicio es más frío, la aplicación pide el motivo (por ejemplo, «ya venía templado») y el PDF lo señala; no genera alerta | RD1086 art. 30.6: «de 60 °C a 10 °C». MAD: igual | — |
| Refrigeración (cámaras, vitrinas, recepción de refrigerado) | **≤ 4 °C** | RD1086 art. 30.3: ≤ 4 °C con vida útil > 24 h; ≤ 8 °C si < 24 h | EUS: cámaras ≤ 6 °C y recepción de frescos ≤ 6 °C; VAL: valores por producto (carne picada ≤ 2 °C, vísceras ≤ 3 °C, carne fresca ≤ 7 °C…). El límite propio del proveedor admite 0–8 °C |
| Congelación (congeladores, recepción de congelado) | **≤ −18 °C** | RD1086 art. 30.4 | EUS y VAL: igual (VAL admite +3 °C en transporte) |
| Mantenimiento en caliente (equipos y recepción de caliente) | **≥ 63 °C** | RD1086 art. 30.2. MAD: igual | EUS y VAL: ≥ 65 °C |
| Aceite de fritura: compuestos polares | **25 %** (por encima, alerta) | EUS: «no alcanza niveles de compuestos polares superiores al 25 %»; VAL: «inferior al 25 %» | — |
| Agua: cloro libre residual (plantilla sugerida) | **0,2 a 1,0 mg/l**, diario | VAL: «persistencia de desinfectante (≥ 0,2 mg/l)»; RD3 anexo I parte C: valor paramétrico 1,0 mg/l; RD3 art. 36.6: la concentración mínima la señala la autoridad sanitaria. EUS: control de cloro diario con depósito propio o suministro propio | Solo para agua de pozo o depósito propio |
| Verificación de termómetros (plantilla sugerida) | «Cuando ocurra», con aviso en «Hoy» si pasan **6 meses** sin registrarla (configurable 1–36 meses en cada registro personalizado) | VAL: verificación semestral de los equipos de vigilancia de temperatura; termómetro patrón calibrado al menos cada dos años | — |
| Mantenimiento de instalaciones (plantilla sugerida) | Mensual (día 1) | EUS: controles mensuales de instalaciones y buenas prácticas | — |
| Revisión de buenas prácticas (plantilla sugerida) | Mensual (día 1) | EUS: «Registro mensual de Control de Buenas Prácticas» | — |
| Nº de controles al día de cada equipo | 2 cámaras, 1 congelador, 3 mantenimiento en caliente | Criterio práctico (EUS pide control diario de cámaras y del mantenimiento en caliente antes de cada turno) | — |
| Conservación de los registros | La aplicación no borra registros; se conservan mientras exista el local | EUS: «al menos los últimos 12 meses» | — |

## Lo que no se ha verificado

- De la guía andaluza solo se ha usado el apartado de cocinado; las guías de Cataluña y Castilla-La Mancha no se han leído. El resto de valores sale del texto estatal y de las guías vasca, valenciana y madrileña. Si un local trabaja con la guía de otra comunidad, debe ajustar los valores.
- Cada registro guarda la referencia que se aplicó ese día (por ejemplo, 70 °C o 75 °C con huevo fresco), de modo que cambiar los valores después no reescribe los registros anteriores.
- La guía valenciana es de 2013 y cita el RD 3484/2000 (ya derogado); sus valores de enfriamiento y cloro coinciden con la normativa vigente citada arriba.
- Ninguna fuente fija un único tiempo de tratamiento para el cocinado: el campo «Tiempo» del registro es informativo.
