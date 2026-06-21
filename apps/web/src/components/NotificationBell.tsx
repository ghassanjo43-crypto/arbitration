import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthContext';
import { api } from '../lib/api';

interface Notification {
  id: string;
  type: string;
  title: string;
  body?: string | null;
  link?: string | null;
  readAt?: string | null;
  createdAt: string;
}

export function NotificationBell() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const { data } = useQuery<Notification[]>({
    queryKey: ['notifications'],
    queryFn: async () => (await api.get('/notifications/mine')).data,
    refetchInterval: 60_000,
    enabled: !!user,
  });

  const markRead = useMutation({
    mutationFn: async (id: string) => api.patch(`/notifications/${id}/read`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['notifications'] }),
  });

  if (!user) return null;
  const items = data ?? [];
  const unread = items.filter((n) => !n.readAt).length;

  const onItem = (n: Notification) => {
    if (!n.readAt) markRead.mutate(n.id);
    setOpen(false);
    if (n.link) navigate(n.link);
  };

  return (
    <div className="notif">
      <button type="button" className="notif__btn" aria-label={t('notifications.ariaOpen')} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span aria-hidden="true">🔔</span>
        {unread > 0 && <span className="notif__badge">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <div className="notif__panel card" role="menu">
          <h3 className="notif__title">{t('notifications.title')}</h3>
          {items.length === 0 ? (
            <p className="muted" style={{ padding: 'var(--sp-2)' }}>{t('notifications.empty')}</p>
          ) : (
            <ul className="notif__list">
              {items.map((n) => (
                <li key={n.id}>
                  <button type="button" className={`notif__item ${n.readAt ? '' : 'notif__item--unread'}`} onClick={() => onItem(n)}>
                    <strong>{n.title}</strong>
                    {n.body && <span className="notif__body">{n.body}</span>}
                    <span className="notif__time">{new Date(n.createdAt).toLocaleString()}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
