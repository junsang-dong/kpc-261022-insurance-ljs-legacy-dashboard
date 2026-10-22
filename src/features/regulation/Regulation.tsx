import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Alert, Card, Progress, SyntheticBadge } from '../../app/ui.tsx';
import { checklistKey } from '../../shared/scoring/index.ts';
import { useStatic } from '../../store/staticData.ts';
import { useWs } from '../../store/workspace.ts';
import { useAssistant } from '../assistant/aiClient.ts';

export function Regulation() {
  const { data: sd } = useStatic();
  const ws = useWs((s) => s.ws);
  const setChecklist = useWs((s) => s.setChecklist);
  const setContext = useAssistant((s) => s.setContext);
  useEffect(() => setContext({ screen: '규제·체크리스트' }), [setContext]);
  if (!sd || !ws) return null;
  const reg = sd.checklist.filter((i) => i.category === 'regulation');
  const cloud = sd.checklist.filter((i) => i.category === 'cloud');
  const prog = (appId: string, list: typeof reg) => list.filter((i) => ws.checklistResults[checklistKey(appId, i.id)]?.done).length;

  return (
    <>
      <div className="page-head">
        <div><h1>규제·보안 및 클라우드 체크리스트</h1><p>앱별 완료율입니다. 항목 체크는 앱 상세에서도 가능합니다. 승인 워크플로(정보보호·준법 승인)는 정식 버전 범위입니다.</p></div>
      </div>
      <Alert kind="warn">규제 항목은 법령·감독규정 개정에 따라 달라질 수 있습니다. <code>public/data/seed/checklists.json</code> 에서 수정하고, 시행 시점의 규정으로 확인하세요.</Alert>
      <Card title={<>앱별 완료율 <SyntheticBadge text="가상 인벤토리" /></>}>
        <div className="table-wrap"><table>
          <thead><tr><th>앱</th><th style={{ width: '30%' }}>규제·보안 ({reg.length}항목)</th><th style={{ width: '30%' }}>클라우드 ({cloud.length}항목)</th></tr></thead>
          <tbody>{ws.applications.map((a) => (
            <tr key={a.id}>
              <td><Link to={`/apps/${a.id}`}>{a.name}</Link></td>
              <td><Progress value={prog(a.id, reg)} max={reg.length} /><span className="small muted">{prog(a.id, reg)}/{reg.length}</span></td>
              <td><Progress value={prog(a.id, cloud)} max={cloud.length} /><span className="small muted">{prog(a.id, cloud)}/{cloud.length}</span></td>
            </tr>
          ))}</tbody>
        </table></div>
      </Card>
      <div className="grid cols-2" style={{ marginTop: 14 }}>
        {[{ t: '규제·보안 체크리스트', list: reg }, { t: '클라우드 체크리스트', list: cloud }].map(({ t, list }) => (
          <Card key={t} title={t}>
            <details open><summary>앱 선택하여 체크</summary>
              {ws.applications.map((a) => (
                <details key={a.id} style={{ margin: '6px 0' }}>
                  <summary>{a.name} <span className="muted small">({prog(a.id, list)}/{list.length})</span></summary>
                  {list.map((i) => (
                    <label key={i.id} className="row" style={{ alignItems: 'flex-start', padding: '2px 0' }}>
                      <input type="checkbox" checked={ws.checklistResults[checklistKey(a.id, i.id)]?.done ?? false} onChange={(e) => setChecklist(a.id, i.id, e.target.checked)} />
                      <span>{i.text}</span>
                    </label>
                  ))}
                </details>
              ))}
            </details>
          </Card>
        ))}
      </div>
    </>
  );
}
