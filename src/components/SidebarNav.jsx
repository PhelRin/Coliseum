import React, { useEffect, useMemo, useState } from 'react';
import { GripVertical, Eye, EyeOff, SlidersHorizontal, Check, RotateCcw } from 'lucide-react';

// The main sidebar tabs. "Customize" lets people drag them into their own order and hide the
// ones they don't use; the layout is saved in the app store ("sidebarLayout").
//
// items: [{ id, label, icon }] in the default order. New tabs added in later versions show up
// at the end of a saved order, so a saved layout never hides them by accident.

const KEY = 'sidebarLayout';

export function SidebarNav({ items, activeTab, onSelect, collapsed, onExpand, Item }) {
    const [layout, setLayout] = useState({ order: [], hidden: [] });
    const [editing, setEditing] = useState(false);
    const [dragId, setDragId] = useState(null);
    const [overId, setOverId] = useState(null);

    useEffect(() => {
        if (!window.electronAPI) return;
        window.electronAPI.getStore(KEY).then((l) => {
            if (l && Array.isArray(l.order)) setLayout({ order: l.order, hidden: Array.isArray(l.hidden) ? l.hidden : [] });
        }).catch(() => {});
    }, []);

    const save = (next) => {
        setLayout(next);
        if (window.electronAPI) window.electronAPI.setStore(KEY, next).catch(() => {});
    };

    const ordered = useMemo(() => {
        const byId = new Map(items.map((i) => [i.id, i]));
        const out = layout.order.filter((id) => byId.has(id)).map((id) => byId.get(id));
        for (const i of items) if (!out.includes(i)) out.push(i);
        return out;
    }, [items, layout.order]);

    const hidden = new Set(layout.hidden);
    const visibleCount = ordered.filter((i) => !hidden.has(i.id)).length;

    const move = (fromId, toId) => {
        if (!fromId || fromId === toId) return;
        const ids = ordered.map((i) => i.id);
        const from = ids.indexOf(fromId);
        ids.splice(from, 1);
        const to = ids.indexOf(toId);
        ids.splice(from <= to ? to + 1 : to, 0, fromId);
        save({ ...layout, order: ids });
    };

    const nudge = (id, dir) => {
        const ids = ordered.map((i) => i.id);
        const i = ids.indexOf(id);
        const j = i + dir;
        if (j < 0 || j >= ids.length) return;
        [ids[i], ids[j]] = [ids[j], ids[i]];
        save({ ...layout, order: ids });
    };

    const toggleHidden = (id) => {
        const next = hidden.has(id) ? layout.hidden.filter((x) => x !== id) : [...layout.hidden, id];
        if (ordered.length - next.length < 1) return; // keep at least one tab
        save({ ...layout, hidden: next });
    };

    const startEditing = () => {
        if (collapsed && onExpand) onExpand();
        setEditing(true);
    };

    if (editing) {
        return (
            <div className="flex-1 min-h-0 flex flex-col">
                <p className="text-[11px] text-muted-foreground px-2 pb-2 leading-snug">Drag tabs into the order you like. The eye hides a tab.</p>
                <div className="space-y-1 flex-1 min-h-0 overflow-y-auto overflow-x-hidden -mx-1 px-1 sidebar-scroll">
                    {ordered.map((item) => {
                        const off = hidden.has(item.id);
                        return (
                            <div
                                key={item.id}
                                data-nav-id={item.id}
                                draggable
                                onDragStart={(e) => {
                                    setDragId(item.id);
                                    e.dataTransfer.effectAllowed = 'move';
                                    e.dataTransfer.setData('text/plain', item.id);
                                }}
                                onDragOver={(e) => {
                                    e.preventDefault();
                                    if (overId !== item.id) setOverId(item.id);
                                }}
                                onDragLeave={() => setOverId((o) => (o === item.id ? null : o))}
                                onDrop={(e) => {
                                    e.preventDefault();
                                    move(dragId || e.dataTransfer.getData('text/plain'), item.id);
                                    setDragId(null);
                                    setOverId(null);
                                }}
                                onDragEnd={() => {
                                    setDragId(null);
                                    setOverId(null);
                                }}
                                onKeyDown={(e) => {
                                    if (e.key === 'ArrowUp') nudge(item.id, -1);
                                    if (e.key === 'ArrowDown') nudge(item.id, 1);
                                }}
                                tabIndex={0}
                                className={`flex items-center gap-2 px-2 py-2 rounded-xl border cursor-grab active:cursor-grabbing select-none transition-colors outline-none focus-visible:border-primary/50
                                    ${dragId === item.id ? 'opacity-40' : ''}
                                    ${overId === item.id && dragId && dragId !== item.id ? 'border-primary/60 bg-primary/10' : 'border-white/5 bg-black/20'}
                                    ${off ? 'text-muted-foreground/40' : 'text-foreground'}`}
                            >
                                <GripVertical size={16} className="text-muted-foreground shrink-0" />
                                {React.cloneElement(item.icon, { size: 18, className: 'shrink-0' })}
                                <span className={`text-sm font-medium truncate flex-1 ${off ? 'line-through' : ''}`}>{item.label}</span>
                                <button
                                    type="button"
                                    onClick={() => toggleHidden(item.id)}
                                    aria-label={`${off ? 'Show' : 'Hide'} ${item.label}`}
                                    title={off ? 'Show this tab' : visibleCount <= 1 ? 'At least one tab stays visible' : 'Hide this tab'}
                                    className="p-1 rounded-lg hover:bg-white/10 text-muted-foreground hover:text-foreground shrink-0"
                                >
                                    {off ? <EyeOff size={14} /> : <Eye size={14} />}
                                </button>
                            </div>
                        );
                    })}
                </div>
                <div className="flex gap-1.5 pt-2">
                    <button type="button" onClick={() => setEditing(false)} className="flex-1 py-2 rounded-xl bg-primary text-black text-sm font-bold flex items-center justify-center gap-1.5">
                        <Check size={14} /> Done
                    </button>
                    <button
                        type="button"
                        onClick={() => save({ order: [], hidden: [] })}
                        title="Back to the original order, with every tab shown"
                        className="px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-muted-foreground text-sm flex items-center gap-1.5"
                    >
                        <RotateCcw size={13} /> Reset
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="flex-1 min-h-0 flex flex-col">
            <nav className="space-y-1 flex-1 min-h-0 overflow-y-auto overflow-x-hidden -mx-1 px-1 sidebar-scroll">
                {ordered.filter((i) => !hidden.has(i.id)).map((item) => (
                    <Item key={item.id} active={activeTab === item.id} onClick={() => onSelect(item.id)} icon={item.icon} label={item.label} isSidebarCollapsed={collapsed} />
                ))}
            </nav>
            <button
                type="button"
                onClick={startEditing}
                title="Customize the sidebar"
                className={`mt-1 flex items-center gap-2 py-1.5 rounded-lg text-[11px] text-muted-foreground/70 hover:text-foreground hover:bg-white/5 transition-colors ${collapsed ? 'justify-center' : 'px-3'}`}
            >
                <SlidersHorizontal size={13} className="shrink-0" />
                {!collapsed && <span>Customize</span>}
            </button>
        </div>
    );
}
