/**
 * Plantillas de alta ORIENTATIVAS por tipo de negocio. No constituyen un plan de
 * autocontrol: cada local debe revisarlas y adaptarlas a su actividad. Todo es editable.
 *
 * Referencias de temperatura usadas como valores iniciales (art. 30 del RD 1086/2020,
 * modificado por el RD 1021/2022): refrigeración ≤ 4 °C (comidas refrigeradas de consumo
 * en menos de 24 h: ≤ 8 °C), congelación ≤ −18 °C, mantenimiento en caliente ≥ 63 °C.
 * Los límites pueden ser solo máximo, solo mínimo o ambos.
 */
import type { BUSINESS_TYPES, EQUIPMENT_TYPES } from '../../schemas/index.js';

type BusinessType = (typeof BUSINESS_TYPES)[number];
type EquipmentType = (typeof EQUIPMENT_TYPES)[number];

export interface EquipmentTemplate {
  name: string;
  type: EquipmentType;
  minTemp: number | null;
  maxTemp: number | null;
  checksPerDay: number;
}

export interface CleaningPlanTemplate {
  name: string;
  frequency: 'daily' | 'weekly' | 'monthly';
  weekday: number | null;
  monthDay: number | null;
  items: { area: string; product: string | null; method: string | null }[];
}

const fridge = (name: string, type: EquipmentType = 'camara', checksPerDay = 2): EquipmentTemplate => ({ name, type, minTemp: null, maxTemp: 4, checksPerDay });
const freezer = (name: string, checksPerDay = 1): EquipmentTemplate => ({ name, type: 'congelador', minTemp: null, maxTemp: -18, checksPerDay });
const hot = (name: string, checksPerDay = 3): EquipmentTemplate => ({ name, type: 'mesa_caliente', minTemp: 63, maxTemp: null, checksPerDay });
const fryer = (name: string): EquipmentTemplate => ({ name, type: 'freidora', minTemp: null, maxTemp: null, checksPerDay: 0 });

const DAILY_KITCHEN: CleaningPlanTemplate = {
  name: 'Limpieza diaria de cocina',
  frequency: 'daily',
  weekday: null,
  monthDay: null,
  items: [
    { area: 'Superficies y mesas de trabajo', product: 'Detergente desengrasante + desinfectante de uso alimentario', method: 'Retirar restos, lavar, aclarar, desinfectar y dejar secar' },
    { area: 'Tablas de corte y utensilios', product: 'Lavavajillas o detergente + desinfectante', method: 'Lavado en lavavajillas a alta temperatura o lavado manual y desinfección' },
    { area: 'Fregaderos y grifería', product: 'Detergente + desinfectante', method: 'Frotar, aclarar y desinfectar' },
    { area: 'Suelos de cocina', product: 'Detergente desengrasante', method: 'Barrer, fregar y aclarar' },
    { area: 'Cubos de basura', product: 'Detergente + desinfectante', method: 'Vaciar, lavar y desinfectar' },
  ],
};
const DAILY_BAR: CleaningPlanTemplate = {
  name: 'Limpieza diaria de barra',
  frequency: 'daily',
  weekday: null,
  monthDay: null,
  items: [
    { area: 'Barra y superficies de servicio', product: 'Detergente + desinfectante de uso alimentario', method: 'Lavar, aclarar y desinfectar' },
    { area: 'Cafetera y vaporizador', product: 'Producto específico para cafeteras', method: 'Purgar, limpiar portafiltros y vaporizador' },
    { area: 'Vitrinas expositoras', product: 'Detergente + desinfectante', method: 'Retirar producto, limpiar y secar' },
    { area: 'Suelos', product: 'Detergente', method: 'Barrer y fregar' },
  ],
};
const WEEKLY: CleaningPlanTemplate = {
  name: 'Limpieza semanal',
  frequency: 'weekly',
  weekday: 1,
  monthDay: null,
  items: [
    { area: 'Interior de cámaras y frigoríficos', product: 'Detergente + desinfectante', method: 'Vaciar por zonas, limpiar baldas y juntas, desinfectar' },
    { area: 'Campana extractora y filtros', product: 'Desengrasante', method: 'Desmontar filtros, desengrasar y aclarar' },
    { area: 'Paredes alicatadas', product: 'Detergente', method: 'Frotar y aclarar' },
    { area: 'Almacén de secos', product: 'Detergente', method: 'Revisar, ordenar y limpiar estanterías' },
  ],
};
const MONTHLY: CleaningPlanTemplate = {
  name: 'Limpieza mensual',
  frequency: 'monthly',
  weekday: null,
  monthDay: 1,
  items: [
    { area: 'Congeladores (desescarche si procede)', product: 'Detergente + desinfectante', method: 'Trasladar producto, desescarchar, limpiar y secar' },
    { area: 'Techos y luminarias', product: 'Detergente', method: 'Limpiar en seco o con paño húmedo' },
    { area: 'Rejillas y desagües', product: 'Desengrasante + desinfectante', method: 'Retirar rejillas, limpiar y desinfectar' },
  ],
};

export const TEMPLATES: Record<BusinessType, { equipment: EquipmentTemplate[]; cleaning: CleaningPlanTemplate[] }> = {
  bar: {
    equipment: [fridge('Cámara frigorífica'), fridge('Vitrina de tapas', 'vitrina', 2), freezer('Congelador'), fryer('Freidora')],
    cleaning: [DAILY_BAR, DAILY_KITCHEN, WEEKLY, MONTHLY],
  },
  restaurante: {
    equipment: [
      fridge('Cámara de carnes y pescados'),
      fridge('Cámara de verduras y lácteos'),
      freezer('Congelador'),
      hot('Mesa caliente'),
      fryer('Freidora 1'),
    ],
    cleaning: [DAILY_KITCHEN, WEEKLY, MONTHLY],
  },
  cafeteria: {
    equipment: [fridge('Vitrina de bollería y tartas', 'vitrina', 2), fridge('Frigorífico'), freezer('Congelador')],
    cleaning: [DAILY_BAR, WEEKLY, MONTHLY],
  },
  obrador: {
    equipment: [fridge('Cámara de materias primas'), fridge('Cámara de producto terminado'), freezer('Congelador'), fryer('Freidora')],
    cleaning: [
      {
        ...DAILY_KITCHEN,
        name: 'Limpieza diaria de obrador',
        items: [
          ...DAILY_KITCHEN.items,
          { area: 'Amasadoras y batidoras', product: 'Detergente + desinfectante', method: 'Retirar restos de masa, lavar y desinfectar' },
        ],
      },
      WEEKLY,
      MONTHLY,
    ],
  },
  catering: {
    equipment: [fridge('Cámara frigorífica'), freezer('Congelador'), hot('Armario de mantenimiento en caliente'), fridge('Vehículo / isotermo refrigerado', 'otro', 1)],
    cleaning: [DAILY_KITCHEN, WEEKLY, MONTHLY],
  },
  tienda: {
    equipment: [fridge('Cámara frigorífica'), fridge('Vitrina refrigerada', 'vitrina', 2), freezer('Arcón congelador')],
    cleaning: [
      {
        name: 'Limpieza diaria de tienda',
        frequency: 'daily',
        weekday: null,
        monthDay: null,
        items: [
          { area: 'Mostrador y báscula', product: 'Detergente + desinfectante de uso alimentario', method: 'Lavar, aclarar y desinfectar' },
          { area: 'Cortadora de fiambre', product: 'Detergente + desinfectante', method: 'Desmontar piezas, lavar y desinfectar' },
          { area: 'Suelos', product: 'Detergente', method: 'Barrer y fregar' },
        ],
      },
      WEEKLY,
      MONTHLY,
    ],
  },
};
