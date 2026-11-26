import React, { useState, useMemo } from 'react';
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
import * as Location from 'expo-location';
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

function isTaskMissed(task) {
  if (task.status === 'completed' || task.status === 'cancelled') return false;
  return new Date(task.scheduled_end).getTime() < Date.now();
}

function isTaskNewUpcoming(task) {
  if (task.status === 'completed' || task.status === 'cancelled') return false;
  return new Date(task.scheduled_end).getTime() >= Date.now();
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export default function ScheduleScreen({ tasks, refreshing, onRefresh }) {
  const [showCalendar, setShowCalendar] = useState(true);
  const [filterTab, setFilterTab] = useState('all'); // 'all' | 'new' | 'missed' | 'completed' | 'cancelled'
  const [selectedDateKey, setSelectedDateKey] = useState(null);

  const now = new Date();
  const [calYear, setCalYear] = useState(now.getFullYear());
  const [calMonth, setCalMonth] = useState(now.getMonth());

  // Add Self Task Modal
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [addTitle, setAddTitle] = useState('');
  const [addAddress, setAddAddress] = useState('');
  const [addDesc, setAddDesc] = useState('');
  const [addDate, setAddDate] = useState('');
  const [addStartTime, setAddStartTime] = useState('');
  const [addEndTime, setAddEndTime] = useState('');

  // Complete Modal
  const [completeModalTask, setCompleteModalTask] = useState(null);
  const [completionNotes, setCompletionNotes] = useState('');

  // Reschedule Modal
  const [rescheduleModalTask, setRescheduleModalTask] = useState(null);
  const [newDate, setNewDate] = useState('');
  const [newStartTime, setNewStartTime] = useState('');
  const [newEndTime, setNewEndTime] = useState('');
  const [reason, setReason] = useState('');

  // Cancel Modal
  const [cancelModalTask, setCancelModalTask] = useState(null);
  const [cancelReason, setCancelReason] = useState('');

  const [submitting, setSubmitting] = useState(false);

  const counts = useMemo(() => {
    let newCount = 0;
    let missedCount = 0;
    let completedCount = 0;
    let cancelledCount = 0;
    tasks.forEach((t) => {
      if (t.status === 'completed') completedCount += 1;
      else if (t.status === 'cancelled') cancelledCount += 1;
      else if (isTaskMissed(t)) missedCount += 1;
      else newCount += 1;
    });
    return {
      all: tasks.length,
      new: newCount,
      missed: missedCount,
      completed: completedCount,
      cancelled: cancelledCount,
    };
  }, [tasks]);

  const dateStatusMap = useMemo(() => {
    const map = {};
    tasks.forEach((t) => {
      const key = toInputDate(t.scheduled_start);
      if (!map[key]) {
        map[key] = { hasNew: false, hasMissed: false, hasCompleted: false, hasCancelled: false };
      }
      if (t.status === 'completed') map[key].hasCompleted = true;
      else if (t.status === 'cancelled') map[key].hasCancelled = true;
      else if (isTaskMissed(t)) map[key].hasMissed = true;
      else map[key].hasNew = true;
    });
    return map;
  }, [tasks]);

  const calendarDays = useMemo(() => {
    const firstDayOfWeek = new Date(calYear, calMonth, 1).getDay();
    const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
    const cells = [];
    for (let i = 0; i < firstDayOfWeek; i++) {
      cells.push(null);
    }
    const pad = (n) => String(n).padStart(2, '0');
    for (let d = 1; d <= daysInMonth; d++) {
      const dateKey = `${calYear}-${pad(calMonth + 1)}-${pad(d)}`;
      cells.push({ day: d, dateKey, info: dateStatusMap[dateKey] || null });
    }
    return cells;
  }, [calYear, calMonth, dateStatusMap]);

  const filteredTasks = useMemo(() => {
    return tasks.filter((t) => {
      if (selectedDateKey && toInputDate(t.scheduled_start) !== selectedDateKey) {
        return false;
      }
      if (filterTab === 'new') return isTaskNewUpcoming(t);
      if (filterTab === 'missed') return isTaskMissed(t);
      if (filterTab === 'completed') return t.status === 'completed';
      if (filterTab === 'cancelled') return t.status === 'cancelled';
      return true;
    });
  }, [tasks, filterTab, selectedDateKey]);

  const changeMonth = (delta) => {
    let nextM = calMonth + delta;
    let nextY = calYear;
    if (nextM < 0) {
      nextM = 11;
      nextY -= 1;
    } else if (nextM > 11) {
      nextM = 0;
      nextY += 1;
    }
    setCalMonth(nextM);
    setCalYear(nextY);
  };

  const openAddModal = () => {
    const start = new Date(Date.now() + 15 * 60 * 1000);
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    setAddTitle('');
    setAddAddress('');
    setAddDesc('');
    setAddDate(selectedDateKey || toInputDate(start.toISOString()));
    setAddStartTime(toInputTime(start.toISOString()));
    setAddEndTime(toInputTime(end.toISOString()));
    setAddModalOpen(true);
  };

  const openReschedule = (task) => {
    setRescheduleModalTask(task);
    setNewDate(toInputDate(task.scheduled_start));
    setNewStartTime(toInputTime(task.scheduled_start));
    setNewEndTime(toInputTime(task.scheduled_end));
    setReason('');
  };

  async function getCurrentCoordsSafe() {
    try {
      const fg = await Location.getForegroundPermissionsAsync();
      if (fg.status !== 'granted') {
        const req = await Location.requestForegroundPermissionsAsync();
        if (req.status !== 'granted') return { lat: null, lng: null };
      }
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      return { lat: pos.coords.latitude, lng: pos.coords.longitude };
    } catch {
      return { lat: null, lng: null };
    }
  }

  async function submitAddTask() {
    if (!addTitle.trim()) {
      Alert.alert('Required', 'Please enter a task title.');
      return;
    }
    const startIso = new Date(`${addDate}T${addStartTime}:00`).toISOString();
    const endIso = new Date(`${addDate}T${addEndTime}:00`).toISOString();
    if (isNaN(new Date(startIso).getTime()) || isNaN(new Date(endIso).getTime())) {
      Alert.alert('Invalid Date/Time', 'Please use YYYY-MM-DD and HH:MM format.');
      return;
    }

    setSubmitting(true);
    try {
      await api.createMyTask({
        title: addTitle.trim(),
        address: addAddress.trim(),
        description: addDesc.trim(),
        scheduled_start: startIso,
        scheduled_end: endIso,
      });
      setAddModalOpen(false);
      Alert.alert('Task Added', 'Your new task has been added to your schedule and synced with Admin.');
      onRefresh();
    } catch (err) {
      Alert.alert('Error', err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function submitComplete() {
    if (!completeModalTask) return;
    setSubmitting(true);
    try {
      const { lat, lng } = await getCurrentCoordsSafe();
      await api.completeTask(completeModalTask.id, completionNotes, lat, lng);
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
      const { lat, lng } = await getCurrentCoordsSafe();
      await api.rescheduleTask(rescheduleModalTask.id, startIso, endIso, reason, lat, lng);
      setRescheduleModalTask(null);
      Alert.alert('Rescheduled', 'Your schedule and current location were sent to the admin.');
      onRefresh();
    } catch (err) {
      Alert.alert('Error', err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function submitCancel() {
    if (!cancelModalTask) return;
    setSubmitting(true);
    try {
      const { lat, lng } = await getCurrentCoordsSafe();
      await api.cancelTask(cancelModalTask.id, cancelReason, lat, lng);
      setCancelModalTask(null);
      setCancelReason('');
      Alert.alert('Task Cancelled', 'The task was marked cancelled and the admin was notified.');
      onRefresh();
    } catch (err) {
      Alert.alert('Error', err.message);
    } finally {
      setSubmitting(false);
    }
  }

  const badgeStyle = (task) => {
    if (task.status === 'completed') return { bg: '#d1fae5', color: '#065f46', label: 'Done' };
    if (task.status === 'cancelled') return { bg: '#fee2e2', color: '#991b1b', label: 'Cancelled' };
    if (isTaskMissed(task)) return { bg: '#fee2e2', color: '#991b1b', label: 'Missed' };
    if (task.status === 'rescheduled') return { bg: '#fef3c7', color: '#92400e', label: 'Rescheduled' };
    return { bg: '#dbeafe', color: '#1e40af', label: 'Scheduled' };
  };

  return (
    <View style={styles.container}>
      <FlatList
        data={filteredTasks}
        keyExtractor={(item) => String(item.id)}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
        ListHeaderComponent={
          <View style={{ marginBottom: 12 }}>
            {/* Top Bar: Add Task + Toggle Calendar */}
            <View style={styles.topHeaderRow}>
              <Text style={styles.sectionHeading}>Work Schedule</Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TouchableOpacity style={styles.addTaskBtn} onPress={openAddModal}>
                  <Text style={styles.addTaskBtnText}>+ Add Task</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.calToggleBtn}
                  onPress={() => setShowCalendar((v) => !v)}
                >
                  <Text style={styles.calToggleText}>
                    {showCalendar ? '📅 Hide' : '📅 Calendar'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Category Filter Tabs: Whole, New, Missed, Done, Cancelled */}
            <View style={styles.filterRow}>
              <TouchableOpacity
                style={[styles.filterChip, filterTab === 'all' && styles.filterChipActive]}
                onPress={() => setFilterTab('all')}
              >
                <Text style={[styles.filterText, filterTab === 'all' && styles.filterTextActive]}>
                  Whole ({counts.all})
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.filterChip, filterTab === 'new' && styles.filterChipActive]}
                onPress={() => setFilterTab('new')}
              >
                <Text style={[styles.filterText, filterTab === 'new' && styles.filterTextActive]}>
                  New ({counts.new})
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.filterChip,
                  filterTab === 'missed' && { backgroundColor: '#ef4444', borderColor: '#ef4444' },
                ]}
                onPress={() => setFilterTab('missed')}
              >
                <Text
                  style={[
                    styles.filterText,
                    filterTab === 'missed' ? { color: '#fff' } : { color: '#b91c1c' },
                  ]}
                >
                  Missed ({counts.missed})
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.filterChip, filterTab === 'completed' && styles.filterChipActive]}
                onPress={() => setFilterTab('completed')}
              >
                <Text
                  style={[styles.filterText, filterTab === 'completed' && styles.filterTextActive]}
                >
                  Done ({counts.completed})
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.filterChip,
                  filterTab === 'cancelled' && { backgroundColor: '#6b7280', borderColor: '#6b7280' },
                ]}
                onPress={() => setFilterTab('cancelled')}
              >
                <Text
                  style={[
                    styles.filterText,
                    filterTab === 'cancelled' && { color: '#fff' },
                  ]}
                >
                  Cancel ({counts.cancelled})
                </Text>
              </TouchableOpacity>
            </View>

            {/* Interactive Month Calendar */}
            {showCalendar && (
              <View style={styles.calCard}>
                <View style={styles.calHeader}>
                  <TouchableOpacity style={styles.calNavBtn} onPress={() => changeMonth(-1)}>
                    <Text style={styles.calNavText}>◀</Text>
                  </TouchableOpacity>
                  <Text style={styles.calMonthTitle}>
                    {MONTHS[calMonth]} {calYear}
                  </Text>
                  <TouchableOpacity style={styles.calNavBtn} onPress={() => changeMonth(1)}>
                    <Text style={styles.calNavText}>▶</Text>
                  </TouchableOpacity>
                </View>

                <View style={styles.weekRow}>
                  {WEEKDAYS.map((w) => (
                    <Text key={w} style={styles.weekDayText}>
                      {w}
                    </Text>
                  ))}
                </View>

                <View style={styles.daysGrid}>
                  {calendarDays.map((cell, idx) => {
                    if (!cell) {
                      return <View key={`empty-${idx}`} style={styles.dayCell} />;
                    }
                    const isSelected = selectedDateKey === cell.dateKey;
                    return (
                      <TouchableOpacity
                        key={cell.dateKey}
                        style={[styles.dayCell, isSelected && styles.dayCellSelected]}
                        onPress={() =>
                          setSelectedDateKey(isSelected ? null : cell.dateKey)
                        }
                      >
                        <Text style={[styles.dayNum, isSelected && { color: '#fff', fontWeight: '800' }]}>
                          {cell.day}
                        </Text>
                        {cell.info && (
                          <View style={styles.dotsRow}>
                            {cell.info.hasNew && <View style={[styles.dotIndicator, { backgroundColor: '#2563eb' }]} />}
                            {cell.info.hasMissed && <View style={[styles.dotIndicator, { backgroundColor: '#ef4444' }]} />}
                            {cell.info.hasCompleted && <View style={[styles.dotIndicator, { backgroundColor: '#10b981' }]} />}
                            {cell.info.hasCancelled && <View style={[styles.dotIndicator, { backgroundColor: '#6b7280' }]} />}
                          </View>
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <View style={styles.calLegend}>
                  <View style={styles.legendItem}>
                    <View style={[styles.dotIndicator, { backgroundColor: '#2563eb' }]} />
                    <Text style={styles.legendText}>Scheduled</Text>
                  </View>
                  <View style={styles.legendItem}>
                    <View style={[styles.dotIndicator, { backgroundColor: '#ef4444' }]} />
                    <Text style={styles.legendText}>Missed</Text>
                  </View>
                  <View style={styles.legendItem}>
                    <View style={[styles.dotIndicator, { backgroundColor: '#10b981' }]} />
                    <Text style={styles.legendText}>Done</Text>
                  </View>
                  <View style={styles.legendItem}>
                    <View style={[styles.dotIndicator, { backgroundColor: '#6b7280' }]} />
                    <Text style={styles.legendText}>Cancelled</Text>
                  </View>
                </View>

                {selectedDateKey && (
                  <TouchableOpacity
                    style={styles.clearDateBtn}
                    onPress={() => setSelectedDateKey(null)}
                  >
                    <Text style={styles.clearDateText}>
                      Showing {selectedDateKey} · Tap to Show All Dates
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
          </View>
        }
        ListEmptyComponent={
          <Text style={styles.empty}>
            No schedules match this filter. Tap "+ Add Task" to create one or pull down to refresh.
          </Text>
        }
        renderItem={({ item }) => {
          const badge = badgeStyle(item);
          return (
            <View style={styles.card}>
              <View style={styles.rowBetween}>
                <Text style={styles.taskTitle}>{item.title}</Text>
                <View style={[styles.badge, { backgroundColor: badge.bg }]}>
                  <Text style={[styles.badgeText, { color: badge.color }]}>{badge.label}</Text>
                </View>
              </View>

              <Text style={styles.time}>
                📅 {formatDateTime(item.scheduled_start)} — {toInputTime(item.scheduled_end)}
              </Text>
              {item.address ? <Text style={styles.meta}>📍 {item.address}</Text> : null}
              {item.description ? <Text style={styles.desc}>{item.description}</Text> : null}
              {item.transferred_from_name ? (
                <Text style={{ fontSize: 12, color: '#1e40af', marginTop: 4, fontWeight: '600' }}>
                  ⇄ Transferred from: {item.transferred_from_name}
                </Text>
              ) : null}
              {item.reschedule_reason ? (
                <Text style={styles.reschedNote}>↻ Rescheduled: {item.reschedule_reason}</Text>
              ) : null}
              {item.cancel_reason ? (
                <Text style={styles.cancelNote}>✕ Cancelled: {item.cancel_reason}</Text>
              ) : null}

              {item.status !== 'completed' && item.status !== 'cancelled' && (
                <View style={styles.actions}>
                  <TouchableOpacity
                    style={[styles.btn, styles.btnGreen]}
                    onPress={() => {
                      setCompleteModalTask(item);
                      setCompletionNotes('');
                    }}
                  >
                    <Text style={styles.btnText}>✓ Done</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.btn, styles.btnAmber]}
                    onPress={() => openReschedule(item)}
                  >
                    <Text style={styles.btnText}>↻ Schedule</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.btn, styles.btnRed]}
                    onPress={() => {
                      setCancelModalTask(item);
                      setCancelReason('');
                    }}
                  >
                    <Text style={styles.btnText}>✕ Cancel</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          );
        }}
      />

      {/* Add Task Modal */}
      <Modal visible={addModalOpen} transparent animationType="slide">
        <View style={styles.modalBackdrop}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>Add New Task</Text>
            <Text style={styles.modalSub}>
              Add a task to your schedule (syncs with Admin calendar)
            </Text>

            <Text style={styles.label}>Task Title *</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g., Client Site Visit - MG Road"
              value={addTitle}
              onChangeText={setAddTitle}
            />

            <Text style={styles.label}>Date (YYYY-MM-DD) *</Text>
            <TextInput style={styles.input} value={addDate} onChangeText={setAddDate} />

            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>Start (HH:MM) *</Text>
                <TextInput
                  style={styles.input}
                  value={addStartTime}
                  onChangeText={setAddStartTime}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>End (HH:MM) *</Text>
                <TextInput style={styles.input} value={addEndTime} onChangeText={setAddEndTime} />
              </View>
            </View>

            <Text style={styles.label}>Location / Address</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g., Kochi Infopark Phase 2"
              value={addAddress}
              onChangeText={setAddAddress}
            />

            <Text style={styles.label}>Description / Notes</Text>
            <TextInput
              style={[styles.input, { height: 64, textAlignVertical: 'top' }]}
              placeholder="Details about the work..."
              value={addDesc}
              onChangeText={setAddDesc}
              multiline
            />

            <View style={styles.actions}>
              <TouchableOpacity
                style={[styles.btn, styles.btnGray]}
                onPress={() => setAddModalOpen(false)}
              >
                <Text style={{ color: '#111827', fontWeight: '600' }}>Close</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btn, styles.btnBlue]}
                onPress={submitAddTask}
                disabled={submitting}
              >
                <Text style={styles.btnText}>{submitting ? 'Adding...' : 'Add Task'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Complete (Done) Modal */}
      <Modal visible={!!completeModalTask} transparent animationType="slide">
        <View style={styles.modalBackdrop}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>Mark Task Done</Text>
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
                <Text style={{ color: '#111827', fontWeight: '600' }}>Back</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btn, styles.btnGreen]}
                onPress={submitComplete}
                disabled={submitting}
              >
                <Text style={styles.btnText}>{submitting ? 'Saving...' : 'Confirm Done'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Reschedule Modal */}
      <Modal visible={!!rescheduleModalTask} transparent animationType="slide">
        <View style={styles.modalBackdrop}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>Reschedule Task</Text>
            <Text style={styles.modalSub}>
              {rescheduleModalTask?.title} (Sends instant notification to Admin)
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
                <Text style={{ color: '#111827', fontWeight: '600' }}>Back</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btn, styles.btnAmber]}
                onPress={submitReschedule}
                disabled={submitting}
              >
                <Text style={styles.btnText}>
                  {submitting ? 'Saving...' : 'Reschedule & Notify'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Cancel Task Modal */}
      <Modal visible={!!cancelModalTask} transparent animationType="slide">
        <View style={styles.modalBackdrop}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>Cancel Task</Text>
            <Text style={styles.modalSub}>
              {cancelModalTask?.title} (Admin will be notified with your reason & location)
            </Text>

            <Text style={styles.label}>Reason for Cancellation</Text>
            <TextInput
              style={[styles.input, { height: 80, textAlignVertical: 'top' }]}
              placeholder="e.g., Client cancelled appointment"
              value={cancelReason}
              onChangeText={setCancelReason}
              multiline
            />

            <View style={styles.actions}>
              <TouchableOpacity
                style={[styles.btn, styles.btnGray]}
                onPress={() => setCancelModalTask(null)}
              >
                <Text style={{ color: '#111827', fontWeight: '600' }}>Back</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btn, styles.btnRed]}
                onPress={submitCancel}
                disabled={submitting}
              >
                <Text style={styles.btnText}>
                  {submitting ? 'Cancelling...' : 'Confirm Cancel'}
                </Text>
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
  topHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  sectionHeading: { fontSize: 18, fontWeight: '800', color: '#111827' },
  addTaskBtn: {
    backgroundColor: '#2563eb',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
  },
  addTaskBtnText: { fontSize: 12, fontWeight: '700', color: '#fff' },
  calToggleBtn: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#d1d5db',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  calToggleText: { fontSize: 12, fontWeight: '700', color: '#2563eb' },
  filterRow: {
    flexDirection: 'row',
    gap: 5,
    marginBottom: 12,
  },
  filterChip: {
    flex: 1,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#d1d5db',
    paddingVertical: 8,
    borderRadius: 999,
    alignItems: 'center',
  },
  filterChipActive: {
    backgroundColor: '#2563eb',
    borderColor: '#2563eb',
  },
  filterText: { fontSize: 11, fontWeight: '700', color: '#374151' },
  filterTextActive: { color: '#fff' },
  calCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    marginBottom: 6,
  },
  calHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  calNavBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#f3f4f6',
    borderRadius: 8,
  },
  calNavText: { fontSize: 13, fontWeight: '700', color: '#111827' },
  calMonthTitle: { fontSize: 15, fontWeight: '700', color: '#111827' },
  weekRow: {
    flexDirection: 'row',
    marginBottom: 6,
  },
  weekDayText: {
    width: '14.28%',
    textAlign: 'center',
    fontSize: 11,
    fontWeight: '700',
    color: '#6b7280',
  },
  daysGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  dayCell: {
    width: '14.28%',
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
  },
  dayCellSelected: {
    backgroundColor: '#2563eb',
  },
  dayNum: { fontSize: 13, fontWeight: '600', color: '#111827' },
  dotsRow: { flexDirection: 'row', gap: 3, marginTop: 3 },
  dotIndicator: { width: 5, height: 5, borderRadius: 3 },
  calLegend: {
    flexDirection: 'row',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderColor: '#f3f4f6',
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendText: { fontSize: 11, color: '#6b7280', fontWeight: '600' },
  clearDateBtn: {
    marginTop: 10,
    backgroundColor: '#eff6ff',
    paddingVertical: 7,
    borderRadius: 8,
    alignItems: 'center',
  },
  clearDateText: { fontSize: 12, fontWeight: '700', color: '#2563eb' },
  empty: { textAlign: 'center', color: '#6b7280', marginTop: 30, fontSize: 14 },
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
  badgeText: { fontSize: 11, fontWeight: '700' },
  time: { fontSize: 13, fontWeight: '600', color: '#2563eb', marginBottom: 4 },
  meta: { fontSize: 13, color: '#4b5563', marginBottom: 4 },
  desc: { fontSize: 13, color: '#6b7280', marginTop: 4 },
  reschedNote: { fontSize: 12, color: '#92400e', marginTop: 4, fontWeight: '600' },
  cancelNote: { fontSize: 12, color: '#991b1b', marginTop: 4, fontWeight: '600' },
  actions: { flexDirection: 'row', gap: 8, marginTop: 14 },
  btn: { flex: 1, paddingVertical: 10, borderRadius: 8, alignItems: 'center' },
  btnBlue: { backgroundColor: '#2563eb' },
  btnGreen: { backgroundColor: '#10b981' },
  btnAmber: { backgroundColor: '#f59e0b' },
  btnRed: { backgroundColor: '#ef4444' },
  btnGray: { backgroundColor: '#e5e7eb' },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 12 },
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
