## ADDED Requirements

### Requirement: Variedad del catálogo de escenarios

El catálogo SHALL ofrecer al menos cinco escenarios y SHALL cubrir, además de
las tres formas ya exigidas, un recorrido **notablemente más largo** que el
resto y una bifurcación de **tres o más ramas**.

Las ramas de una bifurcación SHALL medir aproximadamente lo mismo entre sí, sea
cual sea su número: una rama más corta sería siempre la mejor y la bifurcación
dejaría de ser una decisión.

#### Scenario: El catálogo tiene al menos cinco escenarios

- **WHEN** se consulta el catálogo
- **THEN** contiene al menos cinco escenarios, todos con nombre y descripción distintos

#### Scenario: Hay un escenario claramente más largo

- **WHEN** se comparan las longitudes de recorrido del catálogo
- **THEN** existe un escenario cuyo recorrido es al menos un tercio más largo que la mediana

#### Scenario: Hay una bifurcación de tres ramas

- **WHEN** se consulta el catálogo
- **THEN** existe un escenario con tres o más rutas
- **AND** todas sus rutas parten de la misma entrada y terminan en la misma meta

#### Scenario: Todas las ramas de una bifurcación miden lo mismo

- **WHEN** se compara la longitud de las rutas de cada escenario con una sola entrada y una sola meta
- **THEN** la diferencia entre la más larga y la más corta es despreciable

#### Scenario: El reparto funciona con más de dos rutas

- **GIVEN** un escenario con tres rutas
- **WHEN** aparecen enemigos suficientes
- **THEN** las tres rutas reciben enemigos
