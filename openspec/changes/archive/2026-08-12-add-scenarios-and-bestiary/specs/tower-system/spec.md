## ADDED Requirements

### Requirement: El daño de la torre se resuelve contra la armadura

Cuando una torre alcanza a un enemigo, el daño aplicado SHALL ser el daño de la
torre menos la armadura del enemigo, con un mínimo de 1. Esto SHALL aplicarse
tanto al impacto directo como al daño en área de las torres que lo tengan.

La consecuencia buscada es que una torre de muchos impactos pequeños rinda peor
contra enemigos acorazados que una de pocos impactos grandes con el mismo daño
por segundo nominal.

#### Scenario: El daño en área también se reduce por armadura

- **GIVEN** un mortero que alcanza a un enemigo acorazado dentro de su radio de área
- **WHEN** se aplica el daño
- **THEN** el enemigo pierde el daño de área menos su armadura

#### Scenario: La torre de cadencia alta rinde peor contra armadura

- **GIVEN** dos torres con el mismo daño por segundo nominal, una de impactos pequeños y frecuentes y otra de impactos grandes y espaciados
- **WHEN** ambas atacan al mismo enemigo acorazado durante el mismo tiempo
- **THEN** la torre de impactos grandes le ha quitado más vida
