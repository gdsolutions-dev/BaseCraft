// Seul point d'entrée d'ECharts : modules choisis, enregistrés une fois (jamais `import 'echarts'`).
import * as echarts from 'echarts/core';
import { BarChart, LineChart, PieChart, RadarChart } from 'echarts/charts';
import { GridComponent, LegendComponent, RadarComponent, TitleComponent, TooltipComponent } from 'echarts/components';
import { SVGRenderer } from 'echarts/renderers';

echarts.use([BarChart, LineChart, PieChart, RadarChart, GridComponent, LegendComponent, RadarComponent, TitleComponent, TooltipComponent, SVGRenderer]);

export { echarts };
