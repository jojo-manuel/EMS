import React, { useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  Modal,
  TextInput,
  StyleSheet,
  RefreshControl,
  Alert,
} from 'react-native';
import { api } from '../api';

function formatDateTime(iso) {
  const d = new Date(iso);
  return d.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function toInputDate(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function toInputTime(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function ScheduleScreen({ tasks, refreshing, onRefresh }) {
  const [completeModalTask, setCompleteModalTask] = useState(null);
  const [completionNotes, setCompletionNotes] = useState('');

  const [rescheduleModalTask, setRescheduleModalTask] = useState(null);
  const [newDate, setNewDate] = useState('');
  const [newStartTime, setNewStartTime] = useState('');
  const [newEndTime, setNewEndTime] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const openReschedule = (task) => {
    setRescheduleModalTask(task);
    setNewDate(toInputDate(task.scheduled_start));
    setNewStartTime(toInputTime(task.scheduled_start));
    setNewEndTime(toInputTime(task.scheduled_end));
    setReason('');
  };

  async function submitComplete() {
    if (!completeModalTask) return;
    setSubmitting(true);
    try {
      await api.completeTask(completeModalTask.id, completionNotes);
      setCompleteModalTask(null);
      setCompletionNotes('');
      onRefresh();
    } catch (err) {
      Alert.alert('Error', err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function submitReschedule() {
    if (!rescheduleModalTask) return;
    const startIso = new Date(`${newDate}T${newStartTime}:00`).toISOString();
    const endIso = new Date(`${newDate}T${newEndTime}:00`).toISOString();
    if (isNaN(new Date(startIso).getTime()) || isNaN(new Date(endIso).getTime())) {
      Alert.alert('Invalid Date/Time', 'Please use YYYY-MM-DD and HH:MM format.');
      return;
    }

    setSubmitting(true);
    try {
      await api.rescheduleTask(rescheduleModalTask.id, startIso, endIso, reason);
      setRescheduleModalTask(null);
      Alert.alert('Rescheduled', 'Your schedule was updated and the admin has been notified.');
      onRefresh();
    } catch (err) {
      Alert.alert('Error', err.message);
    } finally {
      setSubmitting(false);
    }
  }

  const badgeStyle = (status) => {
    if (status === 'completed') return { bg: '#d1fae5', color: '#065f46' };
    if (status === 'rescheduled') return { bg: '#fef3c7', color: '#92400e' };
    return { bg: '#dbeafe', color: '#1e40af' };
  };

  return (
    <View style={styles.container}>
      <FlatList
        data={tasks}
        keyExtractor={(item) => String(item.id)}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
        ListEmptyComponent={
          <Text style={styles.empty}>No work assigned yet. Pull down to refresh.</Text>
        }
        renderItem={({ item }) => {
          const badge = badgeStyle(item.status);
          return (
            <View style={styles.card}>
              <View style={styles.rowBetween}>
                <Text style={styles.taskTitle}>{item.title}</Text>
                <View style={[styles.badge, { backgroundColor: badge.bg }]}>
                  <Text style={[styles.badgeText, { color: badge.color }]}>{item.status}</Text>
                </View>
              </View>

              <Text style={styles.time}>
                📅 {formatDateTime(item.scheduled_start)} — {toInputTime(item.scheduled_end)}
              </Text>
              {item.address ? <Text style={styles.meta}>📍 {item.address}</Text> : null}
              {item.description ? <Text style={styles.desc}>{item.description}</Text> : null}

              {item.status !== 'completed' && (
                <View style={styles.actions}>
                  <TouchableOpacity
                    style={[styles.btn, styles.btnGreen]}
                    onPress={() => {
                      setCompleteModalTask(item);
                      setCompletionNotes('');
                    }}
                  >
                    <Text style={styles.btnText}>✓ Mark Complete</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.btn, styles.btnAmber]}
                    onPress={() => openReschedule(item)}
                  >
                    <Text style={styles.btnText}>↻ Reschedule</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          );
        }}
      />

      {/* Complete Modal */}
      <Modal visible={!!completeModalTask} transparent animationType="slide">
        <View style={styles.modalBackdrop}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>Complete Work</Text>
            <Text style={styles.modalSub}>{completeModalTask?.title}</Text>
            <TextInput
              style={[styles.input, { height: 80, textAlignVertical: 'top' }]}
              placeholder="Optional completion notes..."
              value={completionNotes}
              onChangeText={setCompletionNotes}
              multiline
            />
            <View style={styles.actions}>
              <TouchableOpacity
                style={[styles.btn, styles.btnGray]}
                onPress={() => setCompleteModalTask(null)}
              >
                <Text style={{ color: '#111827', fontWeight: '600' }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btn, styles.btnGreen]}
                onPress={submitComplete}
                disabled={submitting}
              >
                <Text style={styles.btnText}>{submitting ? 'Saving...' : 'Confirm Complete'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Reschedule Modal */}
      <Modal visible={!!rescheduleModalTask} transparent animationType="slide">
        <View style={styles.modalBackdrop}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>Reschedule Work</Text>
            <Text style={styles.modalSub}>
              {rescheduleModalTask?.title} (Admin will be notified)
            </Text>

            <Text style={styles.label}>New Date (YYYY-MM-DD)</Text>
            <TextInput style={styles.input} value={newDate} onChangeText={setNewDate} />

            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>Start (HH:MM)</Text>
                <TextInput
                  style={styles.input}
                  value={newStartTime}
                  onChangeText={setNewStartTime}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>End (HH:MM)</Text>
                <TextInput style={styles.input} value={newEndTime} onChangeText={setNewEndTime} />
              </View>
            </View>

            <Text style={styles.label}>Reason for Rescheduling</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g., Client requested afternoon slot"
              value={reason}
              onChangeText={setReason}
            />

            <View style={styles.actions}>
              <TouchableOpacity
                style={[styles.btn, styles.btnGray]}
                onPress={() => setRescheduleModalTask(null)}
              >
                <Text style={{ color: '#111827', fontWeight: '600' }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btn, styles.btnAmber]}
                onPress={submitReschedule}
                disabled={submitting}
              >
                <Text style={styles.btnText}>{submitting ? 'Saving...' : 'Reschedule'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f3f4f6' },
  empty: { textAlign: 'center', color: '#6b7280', marginTop: 40, fontSize: 15 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  taskTitle: { fontSize: 16, fontWeight: '700', color: '#111827', flex: 1, marginRight: 8 },
  badge: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999 },
  badgeText: { fontSize: 12, fontWeight: '700', textTransform: 'capitalize' },
  time: { fontSize: 13, fontWeight: '600', color: '#2563eb', marginBottom: 4 },
  meta: { fontSize: 13, color: '#4b5563', marginBottom: 4 },
  desc: { fontSize: 13, color: '#6b7280', marginTop: 4 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  btn: { flex: 1, paddingVertical: 10, borderRadius: 8, alignItems: 'center' },
  btnGreen: { backgroundColor: '#10b981' },
  btnAmber: { backgroundColor: '#f59e0b' },
  btnGray: { backgroundColor: '#e5e7eb' },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    padding: 20,
  },
  modal: { backgroundColor: '#fff', borderRadius: 14, padding: 20 },
  modalTitle: { fontSize: 18, fontWeight: '700', color: '#111827' },
  modalSub: { fontSize: 13, color: '#6b7280', marginBottom: 14 },
  label: { fontSize: 12, fontWeight: '600', color: '#374151', marginBottom: 4 },
  input: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
    fontSize: 14,
  },
});
