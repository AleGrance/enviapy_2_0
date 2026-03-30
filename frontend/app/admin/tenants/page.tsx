'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Building2, Loader2, Pencil } from 'lucide-react';
import { tenantsApi } from '../../services/api';

interface SessionUser {
  id: string;
  email: string;
  role: 'SUPER_ADMIN' | 'TENANT_ADMIN' | 'CLIENT';
  tenantId: string;
}

interface TenantItem {
  id: string;
  name: string;
  createdAt: string;
}

export default function AdminTenantsPage() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<SessionUser | null>(null);
  const [tenants, setTenants] = useState<TenantItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [newName, setNewName] = useState('');
  const [editingTenant, setEditingTenant] = useState<TenantItem | null>(null);
  const [editingName, setEditingName] = useState('');

  useEffect(() => {
    const token = localStorage.getItem('token');
    const rawUser = localStorage.getItem('user');

    if (!token || !rawUser) {
      router.replace('/login');
      return;
    }

    try {
      const parsedUser = JSON.parse(rawUser) as SessionUser;
      if (parsedUser.role !== 'SUPER_ADMIN') {
        router.replace('/');
        return;
      }
      setCurrentUser(parsedUser);
      loadTenants();
    } catch {
      localStorage.clear();
      router.replace('/login');
    }
  }, []);

  const loadTenants = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await tenantsApi.getAll();
      setTenants(data);
    } catch (err: any) {
      setError(err.response?.data?.message || 'No se pudo cargar la lista de organizaciones.');
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!newName.trim()) return;

    setSaving(true);
    setError('');
    setSuccess('');
    try {
      await tenantsApi.create(newName.trim());
      setNewName('');
      setSuccess('Organizacion creada correctamente.');
      await loadTenants();
    } catch (err: any) {
      setError(err.response?.data?.message || 'No se pudo crear la organizacion.');
    } finally {
      setSaving(false);
    }
  };

  const openEdit = (tenant: TenantItem) => {
    setEditingTenant(tenant);
    setEditingName(tenant.name);
    setError('');
    setSuccess('');
  };

  const handleUpdate = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editingTenant) return;

    setUpdating(true);
    setError('');
    setSuccess('');
    try {
      await tenantsApi.update(editingTenant.id, editingName.trim());
      setEditingTenant(null);
      setSuccess('Organizacion actualizada.');
      await loadTenants();
    } catch (err: any) {
      setError(err.response?.data?.message || 'No se pudo actualizar la organizacion.');
    } finally {
      setUpdating(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#0b141a] text-white px-4 py-6 md:px-8">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button
              onClick={() => router.push('/')}
              className="inline-flex items-center gap-2 rounded-lg bg-[#202c33] px-3 py-2 text-sm text-gray-200 hover:bg-[#2a3942]"
            >
              <ArrowLeft size={16} />
              Volver al chat
            </button>
            <button
              onClick={() => router.push('/admin/users')}
              className="rounded-lg bg-[#202c33] px-3 py-2 text-sm text-gray-200 hover:bg-[#2a3942]"
            >
              Ir a usuarios
            </button>
          </div>
          <div className="text-right">
            <p className="text-xs text-gray-400">Administrador general</p>
            <p className="text-sm">{currentUser?.email}</p>
          </div>
        </div>

        <section className="bg-[#111b21] border border-[#2a3942] rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <Building2 size={18} className="text-green-400" />
            <h1 className="text-lg font-semibold">Organizaciones</h1>
          </div>

          <form onSubmit={handleCreate} className="flex flex-col md:flex-row gap-3 mb-5">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Nombre de la organizacion"
              className="flex-1 rounded-lg bg-[#202c33] border border-[#2a3942] px-3 py-2 text-sm focus:outline-none focus:border-green-500"
              required
            />
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium hover:bg-green-700 disabled:opacity-50"
            >
              {saving ? 'Creando...' : 'Crear organizacion'}
            </button>
          </form>

          {error && <p className="mb-3 rounded-lg bg-red-500/10 border border-red-500/30 px-3 py-2 text-sm text-red-300">{error}</p>}
          {success && <p className="mb-3 rounded-lg bg-green-500/10 border border-green-500/30 px-3 py-2 text-sm text-green-300">{success}</p>}

          {loading ? (
            <div className="h-40 flex items-center justify-center">
              <Loader2 className="animate-spin text-gray-400" />
            </div>
          ) : (
            <div className="overflow-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-400 border-b border-[#2a3942]">
                    <th className="py-2 pr-2">Nombre</th>
                    <th className="py-2 pr-2">ID</th>
                    <th className="py-2 pr-2">Creado</th>
                    <th className="py-2">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {tenants.map((tenant) => (
                    <tr key={tenant.id} className="border-b border-[#1e2b33] text-gray-200">
                      <td className="py-2 pr-2">{tenant.name}</td>
                      <td className="py-2 pr-2 text-xs text-gray-400">{tenant.id}</td>
                      <td className="py-2 pr-2">{new Date(tenant.createdAt).toLocaleString()}</td>
                      <td className="py-2">
                        <button
                          onClick={() => openEdit(tenant)}
                          className="inline-flex items-center gap-1 text-cyan-400 hover:text-cyan-300"
                        >
                          <Pencil size={14} />
                          Editar
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {tenants.length === 0 && <p className="text-sm text-gray-500 py-6 text-center">No hay organizaciones para mostrar.</p>}
            </div>
          )}
        </section>
      </div>

      {editingTenant && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-xl border border-[#2a3942] bg-[#111b21] p-5">
            <h3 className="text-lg font-semibold mb-4">Editar organizacion</h3>
            <form onSubmit={handleUpdate} className="space-y-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Nombre</label>
                <input
                  type="text"
                  value={editingName}
                  onChange={(e) => setEditingName(e.target.value)}
                  required
                  className="w-full rounded-lg bg-[#202c33] border border-[#2a3942] px-3 py-2 text-sm focus:outline-none focus:border-green-500"
                />
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setEditingTenant(null)}
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
