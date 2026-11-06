export type Inspection = {
  workflowId: string;
  connectionVersion: number;
  checkedAt: string;
  status: 'compatible' | 'incompatible' | 'unverified';
  note: string;
  nodes: {
    id: string;
    classType: string;
    status: string;
    issues: { input?: string; code: string; severity: string }[];
  }[];
};
const labels: Record<string, string> = {
  compatible: '声明匹配',
  incompatible: '依赖不匹配',
  unverified: '尚未验证',
  NODE_UNVERIFIED: '节点声明未能验证',
  NODE_MISSING: '节点类型未安装',
  REQUIRED_INPUT_MISSING: '缺少必需输入',
  INPUT_UNDECLARED: '输入未在节点中声明',
  LINK_SOURCE_MISSING: '引用节点不存在',
  OUTPUT_TYPE_UNVERIFIED: '输出类型未知',
  OUTPUT_SLOT_MISSING: '输出序号不存在',
  LINK_TYPE_UNVERIFIED: '自定义连接类型未验证',
  LINK_TYPE_MISMATCH: '连接类型不匹配',
  OPTION_UNAVAILABLE: '枚举或模型选项不可用',
  VALUE_TYPE_MISMATCH: '常量类型不匹配',
  VALUE_RANGE_MISMATCH: '常量超出节点范围',
  CUSTOM_INPUT_UNVERIFIED: '自定义输入尚未验证',
  GRAPH_CYCLE: '节点连接存在循环或受循环阻塞',
  FIELD_SCHEMA_MISMATCH: '公开字段合同与节点声明不匹配',
  MEDIA_SCHEMA_MISMATCH: '媒体槽位与节点上传类型不匹配',
  MEDIA_DISCONNECT_INVALID: '参考图连接无法安全省略',
  MEDIA_OUTPUT_MISMATCH: '媒体输出需要可归档的输出节点',
};
export function DependencyView({ report }: { report: Inspection }) {
  return (
    <section className="workflow-dependency panel" aria-label="工作流依赖报告">
      <h3>{labels[report.status]}</h3>
      <p className="field-hint">
        {new Date(report.checkedAt).toLocaleString()} · 连接配置版本 {report.connectionVersion}
      </p>
      <p>{report.note}</p>
      <details open={report.status !== 'compatible'}>
        <summary>查看 {report.nodes.length} 个节点的检查结果</summary>
        {report.nodes.map((node) => (
          <div key={node.id}>
            <strong>
              #{node.id} {node.classType} · {labels[node.status]}
            </strong>
            {node.issues.map((issue, index) => (
              <p className="field-hint" key={index}>
                {issue.input ? `${issue.input}：` : ''}
                {labels[issue.code] ?? issue.code}
              </p>
            ))}
          </div>
        ))}
      </details>
    </section>
  );
}
