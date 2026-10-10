import 'package:flutter/material.dart';

import '../data/admin_data.dart';
import '../data/admin_snapshot.dart';
import '../data/repositories/admin_repository.dart';
import '../data/future/models/device_alert.dart';
import '../features/devices/devices_page.dart';
import '../features/alerts/alerts_page.dart';
import '../widgets/admin_widgets.dart';
import '../features/dashboard/dashboard_page.dart';
import '../features/stores/stores_page.dart';
import '../features/owners/owners_page.dart';
import '../features/orders/orders_page.dart';
import '../theme/app_spacing.dart';
import 'sidebar.dart';
import 'top_bar.dart';

class AdminShell extends StatefulWidget {
  const AdminShell({super.key, required this.repository});
  final AdminRepository repository;
  @override
  State<AdminShell> createState() => _AdminShellState();
}

class _AdminShellState extends State<AdminShell> {
  final scaffoldKey = GlobalKey<ScaffoldState>();
  late Future<AdminSnapshot> snapshot;
  @override
  void initState() {
    super.initState();
    snapshot = widget.repository.load();
  }

  @override
  void didUpdateWidget(AdminShell oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.repository != widget.repository) {
      snapshot = widget.repository.load();
    }
  }

  Future<DeviceAlert> acknowledge(String id) async {
    await widget.repository.acknowledgeAlert(id);
    final result = await widget.repository.load();
    if (mounted) {
      setState(() {
        snapshot = Future.value(result);
      });
    }
    return result.alerts.firstWhere((alert) => alert.id == id);
  }

  AdminPage selected = AdminPage.dashboard;
  bool unlinkedOnly = false;
  void select(AdminPage page) {
    scaffoldKey.currentState?.closeDrawer();
    setState(() {
      selected = page;
      unlinkedOnly = false;
    });
  }

  @override
  Widget build(BuildContext context) => FutureBuilder<AdminSnapshot>(
    future: snapshot,
    builder: (context, result) {
      if (result.hasError) {
        return Scaffold(
          body: Center(
            child: AppCard(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Text('데이터를 불러오지 못했습니다.'),
                  const SizedBox(height: AppSpacing.lg),
                  AppButton(
                    label: '다시 시도',
                    onPressed: () => setState(() {
                      snapshot = widget.repository.load();
                    }),
                  ),
                ],
              ),
            ),
          ),
        );
      }
      if (!result.hasData) {
        return const Scaffold(body: Center(child: CircularProgressIndicator()));
      }
      final data = AdminData(result.data!);
      return LayoutBuilder(
        builder: (context, constraints) {
          final desktop = constraints.maxWidth >= AppSizes.desktopBreakpoint;
          final page = switch (selected) {
            AdminPage.dashboard => DashboardPage(
              data: data,
              onStores: () => select(AdminPage.stores),
              onOrders: () => select(AdminPage.orders),
              onDevices: () => select(AdminPage.devices),
              onAlerts: () => select(AdminPage.alerts),
              onUnlinked: () => setState(() {
                selected = AdminPage.stores;
                unlinkedOnly = true;
              }),
            ),
            AdminPage.stores => StoresPage(
              data: data,
              initiallyUnlinked: unlinkedOnly,
            ),
            AdminPage.owners => OwnersPage(data: data),
            AdminPage.orders => OrdersPage(data: data),
            AdminPage.devices => DevicesPage(data: data),
            AdminPage.alerts => AlertsPage(
              data: data,
              onAcknowledge: acknowledge,
            ),
          };
          return Scaffold(
            key: scaffoldKey,
            drawer: desktop
                ? null
                : Drawer(
                    width: AppSizes.sidebar,
                    child: Sidebar(selected: selected, onSelected: select),
                  ),
            body: Row(
              children: [
                if (desktop) Sidebar(selected: selected, onSelected: select),
                Expanded(
                  child: Column(
                    children: [
                      TopBar(
                        title: selected.label,
                        onMenu: desktop
                            ? null
                            : () => scaffoldKey.currentState?.openDrawer(),
                      ),
                      const Divider(),
                      Expanded(
                        child: SingleChildScrollView(
                          key: ValueKey(selected),
                          padding: const EdgeInsets.all(AppSpacing.xl),
                          child: Align(
                            alignment: Alignment.topCenter,
                            child: ConstrainedBox(
                              constraints: const BoxConstraints(
                                maxWidth: AppSizes.contentMax,
                              ),
                              child: SizedBox(
                                width: double.infinity,
                                child: page,
                              ),
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          );
        },
      );
    },
  );
}
