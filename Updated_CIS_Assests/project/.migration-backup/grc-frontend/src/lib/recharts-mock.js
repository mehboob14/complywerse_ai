const createMock = (name) => {
  const C = ({ children }) => children || null;
  C.displayName = name;
  return C;
};

const EmptyMock = () => null;

module.exports = {
  ResponsiveContainer: createMock('ResponsiveContainer'),
  PieChart: createMock('PieChart'),
  LineChart: createMock('LineChart'),
  BarChart: createMock('BarChart'),
  AreaChart: createMock('AreaChart'),
  RadarChart: createMock('RadarChart'),
  ScatterChart: createMock('ScatterChart'),
  ComposedChart: createMock('ComposedChart'),
  Pie: EmptyMock,
  Line: EmptyMock,
  Bar: EmptyMock,
  Area: EmptyMock,
  Cell: EmptyMock,
  Radar: EmptyMock,
  Scatter: EmptyMock,
  XAxis: EmptyMock,
  YAxis: EmptyMock,
  ZAxis: EmptyMock,
  CartesianGrid: EmptyMock,
  Tooltip: EmptyMock,
  Legend: EmptyMock,
  PolarGrid: EmptyMock,
  PolarAngleAxis: EmptyMock,
  PolarRadiusAxis: EmptyMock,
  ReferenceLine: EmptyMock,
  ReferenceArea: EmptyMock,
  Brush: EmptyMock,
  Label: EmptyMock,
  LabelList: EmptyMock,
  Funnel: EmptyMock,
  FunnelChart: EmptyMock,
  Treemap: EmptyMock,
  Sankey: EmptyMock,
};
