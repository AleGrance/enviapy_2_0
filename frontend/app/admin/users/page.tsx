'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Loader2, Pencil, UserPlus, UserX } from 'lucide-react';
import { tenantsApi, usersApi } from '../../services/api';

type Role = 'SUPER_ADMIN' | 'TENANT_ADMIN' | 'CLIENT';
type UserStatus = 'ACTIVE' | 'INACTIVE';

interface SessionUser {
  id: string;
  email: string;
  role: Role;
  tenantId: string;
  numberId?: string | null;
  campaignsEnabled?: boolean;
  accountExpiresAt?: string | null;
}

interface UserItem {
  id: string;
  email: string;
  role: Role;
  status: UserStatus;
  tenantId: string;
  numberId?: string | null;
  campaignsEnabled: boolean;
  accountExpiresAt?: string | null;
  createdAt: string;
}

interface TenantItem {
  id: string;
  name: string;
}

function toDateTimeLocalValue(value?: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function toIsoDateTimeValue(value: string) {
  if (!value.trim()) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function formatExpiration(value?: string | null) {
  if (!value) return 'Sin vencimiento';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Sin vencimiento';
  return date.toLocaleString();
}

function formatRoleLabel(role: Role) {
  return {
    SUPER_ADMIN: 'Administrador general',
    TENANT_ADMIN: 'Administrador de la organizacion',
    CLIENT: 'Cliente',
  }[role];
}

function formatUserStatusLabel(status: UserStatus) {
  return status === 'ACTIVE' ? 'Activo' : 'Inactivo';
}

export default function AdminUsersPage() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<SessionUser | null>(null);
  const [users, setUsers] = useState<UserItem[]>([]);
  const [tenants, setTenants] = useState<TenantItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deactivatingId, setDeactivatingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>('CLIENT');
  const [tenantId, setTenantId] = useState('');
  const [campaignsEnabled, setCampaignsEnabled] = useState(false);
  const [accountExpiresAt, setAccountExpiresAt] = useState('');
  const [tenantFilter, setTenantFilter] = useState('');

  const [editingUser, setEditingUser] = useState<UserItem | null>(null);
  const [editEmail, setEditEmail] = useState('');
  const [editRole, setEditRole] = useState<Role>('CLIENT');
  const [editStatus, setEditStatus] = useState<UserStatus>('ACTIVE');
  const [editTenantId, setEditTenantId] = useState('');
  const [editPassword, setEditPassword] = useState('');
  const [editCampaignsEnabled, setEditCampaignsEnabled] = useState(false);
  const [editAccountExpiresAt, setEditAccountExpiresAt] = useState('');
  const [updating, setUpdating] = useState(false);

  const tenantNameById = useMemo(() => {
    const map: Record<string, string> = {};
    for (const tenant of tenants) {
      map[tenant.id] = tenant.name;
    }
    return map;
  }, [tenants]);

  useEffect(() => {
    const token = localStorage.getItem('token');
    const rawUser = localStorage.getItem('user');

    if (!token || !rawUser) {
      router.replace('/login');
      return;
    }

    try {
      const parsedUser = JSON.parse(rawUser) as SessionUser;
      if (parsedUser.role !== 'SUPER_ADMIN' && parsedUser.role !== 'TENANT_ADMIN') {
        router.replace('/');
        return;
      }

      setCurrentUser(parsedUser);
      setTenantId(parsedUser.tenantId);
      setTenantFilter(parsedUser.role === 'SUPER_ADMIN' ? '' : parsedUser.tenantId);
      void loadData(parsedUser.role === 'SUPER_ADMIN' ? undefined : parsedUser.tenantId, parsedUser);
    } catch {
      localStorage.clear();
      router.replace('/login');
    }
  }, []);

  const loadData = async (tenant?: string, sessionUser: SessionUser | null = currentUser) => {
    if (!sessionUser) return;

    setLoading(true);
    setError('');
    try {
      if (sessionUser.role === 'SUPER_ADMIN') {
        const [usersData, tenantsData] = await Promise.all([
          usersApi.getAll(tenant),
          tenantsApi.getAll(),
        ]);
        setUsers(usersData);
        setTenants(tenantsData);
      } else {
        const [usersData, tenantData] = await Promise.all([
          usersApi.getAll(sessionUser.tenantId),
          tenantsApi.getOne(sessionUser.tenantId),
        ]);
        setUsers(usersData);
        setTenants(tenantData ? [tenantData] : []);
      }
    } catch (err: any) {
      setError(err.response?.data?.message || 'No se pudo cargar la administracion de usuarios.');
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    setSuccess('');

    try {
      await usersApi.create({
        email,
        password,
        role,
        tenantId,
        campaignsEnabled,
        accountExpiresAt: toIsoDateTimeValue(accountExpiresAt),
      });
      setEmail('');
      setPassword('');
      setRole('CLIENT');
      setCampaignsEnabled(false);
      setAccountExpiresAt('');
      setSuccess('Usuario creado correctamente.');
      await loadData(tenantFilter || undefined);
    } catch (err: any) {
      setError(err.response?.data?.message || 'No se pudo crear el usuario.');
    } finally {
      setSaving(false);
    }
  };

  const openEditModal = (user: UserItem) => {
    setEditingUser(user);
    setEditEmail(user.email);
    setEditRole(user.role);
    setEditStatus(user.status);
    setEditTenantId(user.tenantId);
    setEditPassword('');
    setEditCampaignsEnabled(Boolean(user.campaignsEnabled));
    setEditAccountExpiresAt(toDateTimeLocalValue(user.accountExpiresAt));
    setError('');
    setSuccess('');
  };

  const handleUpdate = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editingUser) return;

    setUpdating(true);
    setError('');
    setSuccess('');
    try {
      const payload: any = {
        email: editEmail,
        role: editRole,
        status: editStatus,
        tenantId: editTenantId,
        campaignsEnabled: editCampaignsEnabled,
        accountExpiresAt: toIsoDateTimeValue(editAccountExpiresAt),
      };
      if (editPassword.trim()) payload.password = editPassword.trim();

      await usersApi.update(editingUser.id, payload);
      setSuccess('Usuario actualizado.');
      setEditingUser(null);
      await loadData(tenantFilter || undefined);
    } catch (err: any) {
      setError(err.response?.data?.message || 'No se pudo actualizar el usuario.');
    } finally {
      setUpdating(false);
    }
  };

  const handleDeactivate = async (id: string) => {
    if (!confirm('Inactivar este usuario?')) return;
    setDeactivatingId(id);
    setError('');
    setSuccess('');
    try {
      await usersApi.deactivate(id);
      setSuccess('Usuario inactivado.');
      await loadData(tenantFilter || undefined);
    } catch (err: any) {
      setError(err.response?.data?.message || 'No se pudo inactivar el usuario.');
    } finally {
      setDeactivatingId(null);
    }
  };

  return (
    <main className="min-h-screen bg-[#0b141a] px-4 py-6 text-white md:px-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button
              onClick={() => router.push('/')}
              className="inline-flex items-center gap-2 rounded-lg bg-[#202c33] px-3 py-2 text-sm text-gray-200 hover:bg-[#2a3942]"
            >
              <ArrowLeft size={16} />
              Volver al chat
            </button>
            {currentUser?.role === 'SUPER_ADMIN' && (
              <button
                onClick={() => router.push('/admin/tenants')}
                className="rounded-lg bg-[#202c33] px-3 py-2 text-sm text-gray-200 hover:bg-[#2a3942]"
              >
                Ir a organizaciones
              </button>
            )}
          </div>
          <div className="text-right">
            <p className="text-xs text-gray-400">
              {currentUser ? formatRoleLabel(currentUser.role) : ''}
            </p>
            <p className="text-sm">{currentUser?.email}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <section className="rounded-xl border border-[#2a3942] bg-[#111b21] p-5 lg:col-span-1">
            <div className="mb-4 flex items-center gap-2">
              <UserPlus size={18} className="text-green-400" />
              <h1 className="text-lg font-semibold">Crear usuario</h1>
            </div>

            <form className="space-y-4" onSubmit={handleCreate}>
              <div>
                <label className="mb-1 block text-xs text-gray-400">Correo electronico</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="w-full rounded-lg border border-[#2a3942] bg-[#202c33] px-3 py-2 text-sm focus:border-green-500 focus:outline-none"
                  placeholder="usuario@empresa.com"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs text-gray-400">Contrasena</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                  className="w-full rounded-lg border border-[#2a3942] bg-[#202c33] px-3 py-2 text-sm focus:border-green-500 focus:outline-none"
                  placeholder="******"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs text-gray-400">Rol</label>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value as Role)}
                  className="w-full rounded-lg border border-[#2a3942] bg-[#202c33] px-3 py-2 text-sm focus:border-green-500 focus:outline-none"
                >
                  <option value="CLIENT">Cliente</option>
                  <option value="TENANT_ADMIN">Administrador de la organizacion</option>
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs text-gray-400">Organizacion</label>
                <select
                  value={tenantId}
                  onChange={(e) => setTenantId(e.target.value)}
                  disabled={currentUser?.role !== 'SUPER_ADMIN'}
                  className="w-full rounded-lg border border-[#2a3942] bg-[#202c33] px-3 py-2 text-sm focus:border-green-500 focus:outline-none"
                >
                  {tenants.map((tenant) => (
                    <option key={tenant.id} value={tenant.id}>
                      {tenant.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs text-gray-400">Vence el</label>
                <input
                  type="datetime-local"
                  value={accountExpiresAt}
                  onChange={(e) => setAccountExpiresAt(e.target.value)}
                  className="w-full rounded-lg border border-[#2a3942] bg-[#202c33] px-3 py-2 text-sm focus:border-green-500 focus:outline-none"
                />
                <p className="mt-1 text-xs text-gray-500">
                  Dejar vacio para que la cuenta no tenga vencimiento.
                </p>
              </div>

              <label className="flex items-center justify-between gap-3 rounded-lg border border-[#2a3942] bg-[#202c33] px-3 py-2">
                <div>
                  <p className="text-sm text-white">Habilitar campañas</p>
                  <p className="text-xs text-gray-400">Este usuario podra ver y usar el modulo de campañas.</p>
                </div>
                <input
                  type="checkbox"
                  checked={campaignsEnabled}
                  onChange={(e) => setCampaignsEnabled(e.target.checked)}
                  className="h-4 w-4 rounded border-[#2a3942] bg-[#111b21] text-green-500 focus:ring-green-500"
                />
              </label>

              <button
                type="submit"
                disabled={saving || !tenantId}
                className="w-full rounded-lg bg-green-600 py-2 text-sm font-medium hover:bg-green-700 disabled:opacity-50"
              >
                {saving ? 'Creando...' : 'Crear usuario'}
              </button>
            </form>
          </section>

          <section className="rounded-xl border border-[#2a3942] bg-[#111b21] p-5 lg:col-span-2">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">Usuarios</h2>
              {currentUser?.role === 'SUPER_ADMIN' && (
                <div className="flex items-center gap-2">
                  <select
                    value={tenantFilter}
                    onChange={(e) => {
                      const value = e.target.value;
                      setTenantFilter(value);
                      void loadData(value || undefined);
                    }}
                    className="rounded-lg border border-[#2a3942] bg-[#202c33] px-3 py-2 text-sm focus:border-green-500 focus:outline-none"
                  >
                    <option value="">Todas las organizaciones</option>
                    {tenants.map((tenant) => (
                      <option key={tenant.id} value={tenant.id}>
                        {tenant.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {error && (
              <p className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                {error}
              </p>
            )}
            {success && (
              <p className="mb-3 rounded-lg border border-green-500/30 bg-green-500/10 px-3 py-2 text-sm text-green-300">
                {success}
              </p>
            )}

            {loading ? (
              <div className="flex h-56 items-center justify-center">
                <Loader2 className="animate-spin text-gray-400" />
              </div>
            ) : (
              <div className="overflow-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[#2a3942] text-left text-gray-400">
                      <th className="py-2 pr-2">Correo</th>
                      <th className="py-2 pr-2">Rol</th>
                      <th className="py-2 pr-2">Estado</th>
                      <th className="py-2 pr-2">Vence</th>
                      <th className="py-2 pr-2">Campañas</th>
                      <th className="py-2 pr-2">Organizacion</th>
                      <th className="py-2 pr-2">Creado</th>
                      <th className="py-2">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((user) => (
                      <tr key={user.id} className="border-b border-[#1e2b33] text-gray-200">
                        <td className="py-2 pr-2">{user.email}</td>
                        <td className="py-2 pr-2">
                          <span
                            className={`rounded px-2 py-1 text-xs ${
                              user.role === 'SUPER_ADMIN'
                                ? 'bg-fuchsia-500/20 text-fuchsia-300'
                                : user.role === 'TENANT_ADMIN'
                                  ? 'bg-blue-500/20 text-blue-300'
                                  : 'bg-gray-500/20 text-gray-300'
                            }`}
                          >
                            {formatRoleLabel(user.role)}
                          </span>
                        </td>
                        <td className="py-2 pr-2">
                          <span
                            className={`rounded px-2 py-1 text-xs ${
                              user.status === 'ACTIVE'
                                ? 'bg-green-500/20 text-green-300'
                                : 'bg-red-500/20 text-red-300'
                            }`}
                          >
                            {formatUserStatusLabel(user.status)}
                          </span>
                        </td>
                        <td className="py-2 pr-2">{formatExpiration(user.accountExpiresAt)}</td>
                        <td className="py-2 pr-2">
                          <span
                            className={`rounded px-2 py-1 text-xs ${
                              user.campaignsEnabled
                                ? 'bg-emerald-500/20 text-emerald-300'
                                : 'bg-gray-500/20 text-gray-300'
                            }`}
                          >
                            {user.campaignsEnabled ? 'Habilitado' : 'No'}
                          </span>
                        </td>
                        <td className="py-2 pr-2">{tenantNameById[user.tenantId] || user.tenantId}</td>
                        <td className="py-2 pr-2">{new Date(user.createdAt).toLocaleString()}</td>
                        <td className="py-2">
                          <div className="flex items-center gap-3">
                            <button
                              onClick={() => openEditModal(user)}
                              className="inline-flex items-center gap-1 text-cyan-400 hover:text-cyan-300"
                            >
                              <Pencil size={14} />
                              Editar
                            </button>
                            <button
                              disabled={
                                deactivatingId === user.id ||
                                user.id === currentUser?.id ||
                                user.status === 'INACTIVE'
                              }
                              onClick={() => handleDeactivate(user.id)}
                              className="inline-flex items-center gap-1 text-yellow-400 hover:text-yellow-300 disabled:opacity-40"
                              title={
                                user.id === currentUser?.id
                                  ? 'No puedes inactivar tu propio usuario'
                                  : user.status === 'INACTIVE'
                                    ? 'Usuario ya inactivo'
                                    : 'Inactivar usuario'
                              }
                            >
                              <UserX size={14} />
                              Inactivar
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {users.length === 0 && (
                  <p className="py-6 text-center text-sm text-gray-500">No hay usuarios para mostrar.</p>
                )}
              </div>
            )}
          </section>
        </div>
      </div>

      {editingUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-xl border border-[#2a3942] bg-[#111b21] p-5">
            <h3 className="mb-4 text-lg font-semibold">Editar usuario</h3>
            <form onSubmit={handleUpdate} className="space-y-3">
              <div>
                <label className="mb-1 block text-xs text-gray-400">Correo electronico</label>
                <input
                  type="email"
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                  required
                  className="w-full rounded-lg border border-[#2a3942] bg-[#202c33] px-3 py-2 text-sm focus:border-green-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-400">Contrasena (opcional)</label>
                <input
                  type="password"
                  value={editPassword}
                  minLength={6}
                  onChange={(e) => setEditPassword(e.target.value)}
                  className="w-full rounded-lg border border-[#2a3942] bg-[#202c33] px-3 py-2 text-sm focus:border-green-500 focus:outline-none"
                  placeholder="Dejar vacio para no cambiar"
                />
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <div>
                  <label className="mb-1 block text-xs text-gray-400">Rol</label>
                  <select
                    value={editRole}
                    onChange={(e) => setEditRole(e.target.value as Role)}
                    className="w-full rounded-lg border border-[#2a3942] bg-[#202c33] px-3 py-2 text-sm focus:border-green-500 focus:outline-none"
                  >
                    <option value="CLIENT">Cliente</option>
                    <option value="TENANT_ADMIN">Administrador de la organizacion</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-gray-400">Estado</label>
                  <select
                    value={editStatus}
                    onChange={(e) => setEditStatus(e.target.value as UserStatus)}
                    className="w-full rounded-lg border border-[#2a3942] bg-[#202c33] px-3 py-2 text-sm focus:border-green-500 focus:outline-none"
                  >
                    <option value="ACTIVE">Activo</option>
                    <option value="INACTIVE">Inactivo</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-gray-400">Organizacion</label>
                  <select
                    value={editTenantId}
                    onChange={(e) => setEditTenantId(e.target.value)}
                    disabled={currentUser?.role !== 'SUPER_ADMIN'}
                    className="w-full rounded-lg border border-[#2a3942] bg-[#202c33] px-3 py-2 text-sm focus:border-green-500 focus:outline-none"
                  >
                    {tenants.map((tenant) => (
                      <option key={tenant.id} value={tenant.id}>
                        {tenant.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-400">Vence el</label>
                <input
                  type="datetime-local"
                  value={editAccountExpiresAt}
                  onChange={(e) => setEditAccountExpiresAt(e.target.value)}
                  className="w-full rounded-lg border border-[#2a3942] bg-[#202c33] px-3 py-2 text-sm focus:border-green-500 focus:outline-none"
                />
                <p className="mt-1 text-xs text-gray-500">Dejar vacio para quitar el vencimiento.</p>
              </div>
              <label className="flex items-center justify-between gap-3 rounded-lg border border-[#2a3942] bg-[#202c33] px-3 py-2">
                <div>
                  <p className="text-sm text-white">Habilitar campañas</p>
                  <p className="text-xs text-gray-400">Controla si este usuario puede acceder al modulo.</p>
                </div>
                <input
                  type="checkbox"
                  checked={editCampaignsEnabled}
                  onChange={(e) => setEditCampaignsEnabled(e.target.checked)}
                  className="h-4 w-4 rounded border-[#2a3942] bg-[#111b21] text-green-500 focus:ring-green-500"
                />
              </label>
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setEditingUser(null)}
                  className="rounded-lg bg-[#202c33] px-3 py-2 text-sm text-gray-200 hover:bg-[#2a3942]"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={updating}
                  className="rounded-lg bg-green-600 px-3 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
                >
                  {updating ? 'Guardando...' : 'Guardar cambios'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
