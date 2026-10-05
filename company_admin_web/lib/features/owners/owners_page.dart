import 'package:flutter/material.dart';

import '../../data/admin_data.dart';
import '../../data/models.dart';
import '../../theme/app_spacing.dart';
import '../../widgets/admin_widgets.dart';

class OwnersPage extends StatefulWidget {
  const OwnersPage({super.key, required this.data});
  final AdminData data;
  @override
  State<OwnersPage> createState() => _OwnersPageState();
}

class _OwnersPageState extends State<OwnersPage> {
  final search = TextEditingController();
  String connection = '전체';
  @override
  void dispose() {
    search.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final data = widget.data;
    final query = search.text.trim().toLowerCase();
    final owners = data.owners
        .where(
          (owner) =>
              '${owner.id} ${owner.loginId}'.toLowerCase().contains(query) &&
              (connection == '전체' ||
                  (connection == '연결됨'
                      ? data.storesForOwner(owner.id).isNotEmpty
                      : data.storesForOwner(owner.id).isEmpty)),
        )
        .toList();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const PageHeading(
          title: '점주 계정',
          description: '점주 로그인 ID와 계정별 연결 매장을 조회합니다.',
        ),
        AppCard(
          child: Wrap(
            spacing: AppSpacing.lg,
            runSpacing: AppSpacing.lg,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              AppSearch(
                controller: search,
                label: '점주 ID / 로그인 ID',
                onChanged: (_) => setState(() {}),
              ),
              AppFilter(
                label: '매장 연결',
                value: connection,
                items: const {'전체': '전체', '연결됨': '연결됨', '미연결': '미연결'},
                onChanged: (value) => setState(() => connection = value),
              ),
              AppButton(
                label: '초기화',
                icon: Icons.refresh,
                onPressed: () => setState(() {
                  search.clear();
                  connection = '전체';
                }),
              ),
            ],
          ),
        ),
        const SizedBox(height: AppSpacing.xl),
        SectionHeading(title: '점주 계정 목록 · ${owners.length}개'),
        AppTable(
          columns: const ['점주 ID', '로그인 ID', '연결 매장 수', '매장 연결', ''],
          rows: owners.map((owner) {
            final stores = data.storesForOwner(owner.id);
            return DataRow(
              key: ValueKey(owner.id),
              cells: [
                DataCell(Text('${owner.id}')),
                DataCell(Text(owner.loginId)),
                DataCell(Text('${stores.length}곳')),
                DataCell(ConnectionBadge(connected: stores.isNotEmpty)),
                DataCell(
                  AppButton(
                    label: '연결 매장',
                    onPressed: () => _showOwner(context, data, owner),
                  ),
                ),
              ],
            );
          }).toList(),
        ),
      ],
    );
  }
}

Future<void> _showOwner(BuildContext context, AdminData data, Owner owner) {
  final stores = data.storesForOwner(owner.id);
  return showDetails(
    context,
    title: '점주 계정 상세',
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        DetailField(label: '점주 ID', value: '${owner.id}'),
        DetailField(label: '로그인 ID', value: owner.loginId),
        const Divider(),
        const SizedBox(height: AppSpacing.lg),
        SectionHeading(title: '연결 매장 · ${stores.length}곳'),
        if (stores.isEmpty) const Text('연결된 매장이 없습니다.'),
        for (final store in stores)
          DetailField(
            label: store.name,
            value:
                '${store.address}\n담당 관리자: ${data.admin(store.adminId).name}',
          ),
      ],
    ),
  );
}
